import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

// Meowth-local breadcrumb component. Inspired by surety's
// components/layout/breadcrumbs.tsx (commit cbf7045f) but adapted:
// the aria-label is English to match meowth's single-language UI,
// and surety's "首页"/"surety" brand strings are deferred to the
// caller via the `items` prop so nothing here references the host
// product directly.

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground flex items-center gap-1 text-sm">
      {items.map((item, index) => (
        <span key={item.label} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
          {item.href ? (
            <Link to={item.href} className="hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-foreground font-medium">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
