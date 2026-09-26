import { BUSINESS_NAME } from '@panesypan/shared';
import { ImageResponse } from 'next/og';

export const alt = `${BUSINESS_NAME}, panadería en Dosquebradas`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#F7ECDF',
        borderBottom: '24px solid #E0B25C',
      }}
    >
      <div style={{ fontSize: 110, fontWeight: 700, color: '#A1452E' }}>{BUSINESS_NAME}</div>
      <div style={{ marginTop: 24, fontSize: 44, color: '#5A3A2E' }}>
        Panadería en Dosquebradas, Risaralda
      </div>
    </div>,
    size,
  );
}
