import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

/** Página provisional de una sección que se construye en un checkpoint posterior. */
export function ComingSoon({ title, description, checkpoint }: { title: string; description: string; checkpoint: number }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <p className="text-sm text-fg-muted">Esta sección se construye en el checkpoint {checkpoint}.</p>
      </Card>
    </>
  );
}
