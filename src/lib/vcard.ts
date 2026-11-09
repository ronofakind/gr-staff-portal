/** push 58 · "Add to contacts": /api/contact sends a real .vcf (name, photo, number, company); the phone shows its own "Add contact" screen. */
export function addToContacts(id: 'ronnie' | 'georges' | 'all') {
  window.location.href = `/api/contact?id=${id}`;
}
