import { Alert, Title } from "@mantine/core";

export default function DashboardPage() {
  return (
    <>
      <Title order={3}>Dashboard</Title>
      <Alert mt="md" color="gray">
        Sayaç kartları ve kullanıcı daveti buraya gelecek.
        Backend `GET /dashboard/summary` (kontrat §10) henüz yazılmadı.
      </Alert>
    </>
  );
}