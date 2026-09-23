import { BUSINESS_NAME } from '@panesypan/shared';
import { cn } from '@/lib/utils';

/** Logo de la panadería (versión liviana, 320 px). */
export function BrandLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-panesypan-320.webp"
      alt={`Logo de ${BUSINESS_NAME}`}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full', className)}
    />
  );
}
