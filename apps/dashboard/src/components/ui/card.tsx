import { LayerCard } from '@nocoo/basalt';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function Card({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof LayerCard> & { children?: ReactNode }) {
  return (
    <LayerCard padding="none" outlined className={className} {...props}>
      {children}
    </LayerCard>
  );
}

export const CardHeader = LayerCard.Header;
export const CardContent = LayerCard.Body;
export const CardFooter = LayerCard.Footer;

export function CardTitle({ children, className }: { children?: ReactNode; className?: string }) {
  return <h3 className={className}>{children}</h3>;
}

export function CardDescription({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <p className={className}>{children}</p>;
}
