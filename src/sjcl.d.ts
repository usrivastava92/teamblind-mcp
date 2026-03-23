declare module "sjcl" {
  type JsonCipherText = string;

  interface Sjcl {
    encrypt(password: string, plaintext: string): JsonCipherText;
    decrypt(password: string, ciphertext: JsonCipherText): string;
  }

  const sjcl: Sjcl;
  export default sjcl;
}
