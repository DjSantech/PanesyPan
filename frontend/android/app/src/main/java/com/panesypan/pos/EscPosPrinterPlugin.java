package com.panesypan.pos;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Envía bytes ESC/POS a la impresora térmica interna del POS (USB interno o puerto serie).
 * La caja registradora va conectada a la impresora, así que se abre con el comando ESC p.
 */
@CapacitorPlugin(name = "EscPosPrinter")
public class EscPosPrinterPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.panesypan.pos.USB_PERMISSION";
    private static final String[] SERIAL_PREFIXES = {
        "ttyS", "ttyMT", "ttyHS", "ttyHSL", "ttyUSB", "ttyACM", "ttyGS"
    };
    private static final int CHUNK = 4096;
    private static final int USB_TIMEOUT_MS = 3000;
    private static final int STATUS_TIMEOUT_MS = 800;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void listTargets(PluginCall call) {
        JSArray targets = new JSArray();
        UsbManager usb = usbManager();
        if (usb != null) {
            for (UsbDevice d : usb.getDeviceList().values()) {
                JSObject t = new JSObject();
                t.put("id", "usb:" + d.getVendorId() + ":" + d.getProductId());
                t.put("kind", "usb");
                StringBuilder label = new StringBuilder();
                if (Build.VERSION.SDK_INT >= 21) {
                    if (d.getManufacturerName() != null) label.append(d.getManufacturerName()).append(' ');
                    if (d.getProductName() != null) label.append(d.getProductName()).append(' ');
                }
                label.append(String.format("(%04x:%04x) clases:", d.getVendorId(), d.getProductId()));
                for (int i = 0; i < d.getInterfaceCount(); i++) {
                    label.append(' ').append(d.getInterface(i).getInterfaceClass());
                }
                t.put("label", label.toString().trim());
                targets.put(t);
            }
        }
        File[] devs = new File("/dev").listFiles();
        if (devs != null) {
            for (File f : devs) {
                String n = f.getName();
                boolean match = false;
                for (String p : SERIAL_PREFIXES) {
                    if (n.startsWith(p)) { match = true; break; }
                }
                if (!match || !f.canRead() || !f.canWrite()) continue;
                JSObject t = new JSObject();
                t.put("id", "serial:" + f.getAbsolutePath());
                t.put("kind", "serial");
                t.put("label", "Puerto serie " + f.getAbsolutePath());
                targets.put(t);
            }
        }
        JSObject ret = new JSObject();
        ret.put("targets", targets);
        call.resolve(ret);
    }

    @PluginMethod
    public void write(final PluginCall call) {
        final String target = call.getString("target");
        final String data = call.getString("data");
        final int baud = call.getInt("baud", 115200);
        if (target == null || data == null) {
            call.reject("Faltan los parámetros target o data.");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Los datos no son base64 válido.");
            return;
        }
        io.execute(() -> {
            try {
                if (target.startsWith("usb:")) {
                    writeUsb(target, bytes);
                } else if (target.startsWith("serial:")) {
                    writeSerial(target.substring(7), baud, bytes);
                } else {
                    throw new Exception("Destino desconocido: " + target);
                }
                JSObject ret = new JSObject();
                ret.put("bytes", bytes.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Error al imprimir.");
            }
        });
    }

    @PluginMethod
    public void readStatus(final PluginCall call) {
        final String target = call.getString("target");
        final int baud = call.getInt("baud", 115200);
        if (target == null) {
            call.reject("Falta el parámetro target.");
            return;
        }
        io.execute(() -> {
            Integer b = null;
            try {
                byte[] cmd = {0x10, 0x04, 0x01};
                if (target.startsWith("usb:")) {
                    b = statusUsb(target, cmd);
                } else if (target.startsWith("serial:")) {
                    b = statusSerial(target.substring(7), baud, cmd);
                }
            } catch (Exception ignored) {
                b = null;
            }
            JSObject ret = new JSObject();
            if (b == null) {
                ret.put("drawerOpen", JSObject.NULL);
            } else {
                // Bit 2 (0x04): estado del pin del cajón. En la mayoría de impresoras
                // 0 = cajón abierto; depende del modelo.
                ret.put("drawerOpen", (b & 0x04) == 0);
            }
            call.resolve(ret);
        });
    }

    // ---------- USB ----------

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    private UsbDevice findUsb(String target) throws Exception {
        String[] parts = target.split(":");
        if (parts.length != 3) throw new Exception("Destino USB inválido: " + target);
        int vid = Integer.parseInt(parts[1]);
        int pid = Integer.parseInt(parts[2]);
        UsbManager usb = usbManager();
        if (usb == null) throw new Exception("Este equipo no tiene USB host.");
        for (UsbDevice d : usb.getDeviceList().values()) {
            if (d.getVendorId() == vid && d.getProductId() == pid) return d;
        }
        throw new Exception("No se encontró la impresora USB " + target + ".");
    }

    private void ensurePermission(final UsbDevice device) throws Exception {
        final UsbManager usb = usbManager();
        if (usb.hasPermission(device)) return;
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicBoolean granted = new AtomicBoolean(false);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (ACTION_USB_PERMISSION.equals(intent.getAction())) {
                    granted.set(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
                    latch.countDown();
                }
            }
        };
        Context ctx = getContext();
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            ctx.registerReceiver(receiver, filter);
        }
        try {
            // En API 34+ un PendingIntent mutable exige intent explícito.
            Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(ctx.getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, intent, flags);
            usb.requestPermission(device, pi);
            if (!latch.await(60, TimeUnit.SECONDS)) {
                throw new Exception("Se agotó el tiempo esperando el permiso USB.");
            }
        } finally {
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) { }
        }
        if (!granted.get()) throw new Exception("Permiso USB denegado para la impresora.");
    }

    private interface UsbAction<T> {
        T run(UsbDeviceConnection conn, UsbEndpoint out, UsbEndpoint in) throws Exception;
    }

    private <T> T withUsb(String target, UsbAction<T> action) throws Exception {
        UsbDevice device = findUsb(target);
        ensurePermission(device);
        UsbInterface iface = null;
        UsbEndpoint out = null;
        UsbEndpoint in = null;
        for (int i = 0; i < device.getInterfaceCount() && out == null; i++) {
            UsbInterface cand = device.getInterface(i);
            UsbEndpoint candIn = null;
            for (int e = 0; e < cand.getEndpointCount(); e++) {
                UsbEndpoint ep = cand.getEndpoint(e);
                if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                if (ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    out = ep;
                } else {
                    candIn = ep;
                }
            }
            if (out != null) {
                iface = cand;
                in = candIn;
            }
        }
        if (iface == null) throw new Exception("La impresora USB no tiene un endpoint de salida.");
        UsbDeviceConnection conn = usbManager().openDevice(device);
        if (conn == null) throw new Exception("No se pudo abrir la impresora USB.");
        try {
            if (!conn.claimInterface(iface, true)) {
                throw new Exception("No se pudo reservar la interfaz USB de la impresora.");
            }
            try {
                return action.run(conn, out, in);
            } finally {
                conn.releaseInterface(iface);
            }
        } finally {
            conn.close();
        }
    }

    private void bulkWrite(UsbDeviceConnection conn, UsbEndpoint out, byte[] bytes) throws Exception {
        int offset = 0;
        while (offset < bytes.length) {
            int len = Math.min(CHUNK, bytes.length - offset);
            byte[] chunk = new byte[len];
            System.arraycopy(bytes, offset, chunk, 0, len);
            int sent = conn.bulkTransfer(out, chunk, len, USB_TIMEOUT_MS);
            if (sent < 0) throw new Exception("Falló el envío USB a la impresora.");
            offset += sent;
        }
    }

    private void writeUsb(String target, final byte[] bytes) throws Exception {
        withUsb(target, (conn, out, in) -> {
            bulkWrite(conn, out, bytes);
            return null;
        });
    }

    private Integer statusUsb(String target, final byte[] cmd) throws Exception {
        return withUsb(target, (conn, out, in) -> {
            if (in == null) return null;
            bulkWrite(conn, out, cmd);
            byte[] buf = new byte[64];
            int n = conn.bulkTransfer(in, buf, buf.length, STATUS_TIMEOUT_MS);
            return n > 0 ? (buf[n - 1] & 0xff) : null;
        });
    }

    // ---------- Serie ----------

    private File serialFile(String path) throws Exception {
        File f = new File(path);
        if (!f.exists()) throw new Exception("No existe el puerto " + path + ".");
        if (!f.canWrite()) throw new Exception("Sin permiso de escritura en " + path + ".");
        return f;
    }

    private void configureBaud(String path, int baud) {
        // Sin JNI: se intenta con stty; si el equipo no lo tiene, se usa la velocidad actual.
        try {
            Process p = Runtime.getRuntime().exec(new String[] {
                "stty", "-F", path, String.valueOf(baud), "raw", "-echo"
            });
            p.waitFor();
        } catch (Exception ignored) {
        }
    }

    private void writeSerial(String path, int baud, byte[] bytes) throws Exception {
        File f = serialFile(path);
        configureBaud(path, baud);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bytes);
            out.flush();
        }
    }

    private Integer statusSerial(String path, int baud, byte[] cmd) throws Exception {
        File f = serialFile(path);
        configureBaud(path, baud);
        final FileInputStream in = new FileInputStream(f);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(cmd);
            out.flush();
            final int[] result = {-1};
            Thread reader = new Thread(() -> {
                try { result[0] = in.read(); } catch (Exception ignored) { }
            });
            reader.start();
            reader.join(STATUS_TIMEOUT_MS);
            if (reader.isAlive()) {
                // Cerrar el stream suele desbloquear la lectura pendiente.
                try { in.close(); } catch (Exception ignored) { }
                return null;
            }
            return result[0] >= 0 ? result[0] : null;
        } finally {
            try { in.close(); } catch (Exception ignored) { }
        }
    }
}
