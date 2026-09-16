export async function getServerSession(event: { session?: { uid: string } }) {
  return event.session ?? null
}
