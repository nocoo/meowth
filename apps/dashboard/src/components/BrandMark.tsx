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
      src="/logo-80.png?v=5d7236ba"
      srcSet="/logo-24.png?v=5d7236ba 24w, /logo-80.png?v=5d7236ba 80w, /logo-192.png?v=5d7236ba 192w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={alt}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
