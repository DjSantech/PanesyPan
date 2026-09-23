import { House } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Esta página no existe"
      description="Revisa la dirección o vuelve al inicio."
      action={
        <Button asChild className="mt-2">
          <Link to="/">
            <House aria-hidden="true" /> Ir al inicio
          </Link>
        </Button>
      }
    />
  );
}
