/// <reference types="vite/client" />

/** Uygulamanın okuduğu derleme zamanı değişkenleri.
 *
 *  Vite yalnız VITE_ önekli değişkenleri istemciye yayar; buradaki tip bildirimi
 *  de yanlış isim yazıldığında derlemede yakalanmasını sağlar.
 */
interface ImportMetaEnv {
  /** Backend'in kök adresi. Geliştirmede tanımsız bırakılır ve "/api" proxy'si
   *  devreye girer; yayında "https://<backend-adresi>" verilir. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
