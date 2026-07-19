import { Alert, Title } from "@mantine/core";

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <Title order={3}>{title}</Title>
      <Alert mt="md" color="gray">
        Bu ekran henüz yapım aşamasında.
      </Alert>
    </>
  );
}