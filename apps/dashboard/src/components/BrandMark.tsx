import { cn } from '@/lib/utils';

export default function BrandMark({
  size = 24,
  alt = '',
  className,
}: {
  size?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src="/logo-80.png"
      srcSet="/logo-24.png 24w, /logo-80.png 80w, /logo-192.png 192w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={alt}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
