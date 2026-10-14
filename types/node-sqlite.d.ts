// node:sqlite yerleşik modülü, sorgu çıktısını SQLOutputValue (union) olarak tipler.
// Uygulama saf JS olduğundan, satır/nitelik erişimlerinde pratiklik için bu modülü
// "any" döndürecek şekilde genişletiyoruz (kademeli JSDoc tiplendirmesine izin verir).
declare module 'node:sqlite' {
  interface DatabaseSync {
    prepare(sql: string): any;
    exec(sql: string): void;
  }
  interface StatementSync {
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
    run(...params: unknown[]): any;
    iterate(...params: unknown[]): IterableIterator<any>;
  }
}
