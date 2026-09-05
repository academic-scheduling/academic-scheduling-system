import { Alert, Title } from "@mantine/core";

import { useT } from "../i18n";

export default function PlaceholderPage({ title }: { title: string }) {
  const t = useT();
  return (
    <>
      <Title order={3}>{title}</Title>
      <Alert mt="md" color="gray">
        {t.common.underConstruction}
      </Alert>
    </>
  );
}