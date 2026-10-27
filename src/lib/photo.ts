import { supabase } from './supabase';

/** Shrink to a 400px square JPEG, upload to the public "avatars" bucket, save the URL on the staff row. */
export async function uploadPhoto(staffId: string, file: File) {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height);
  const c = document.createElement('canvas'); c.width = c.height = 400;
  c.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
  const path = `${staffId}.jpg`;
  const up = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;
  const { error } = await supabase.from('staff').update({ photo_url: url }).eq('id', staffId);
  if (error) throw error;
  return url;
}
