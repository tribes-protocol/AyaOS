import { KeyPair, KeyPairSchema } from '@/common/types'
import { ApiKeyStamper } from '@turnkey/sdk-server'
import { createDecipheriv, createHash } from 'crypto'
import EC from 'elliptic'
import * as fs from 'fs'

// eslint-disable-next-line new-cap
export const ec = new EC.ec('p256')

export class KeychainManager {
  private readonly keyPairData: KeyPair

  public get publicKey(): string {
    return this.keyPairData.publicKey
  }

  public get turnkeyApiKeyStamper(): ApiKeyStamper {
    return new ApiKeyStamper({
      apiPublicKey: this.keyPairData.publicKey,
      apiPrivateKey: this.keyPairData.privateKey
    })
  }

  constructor(keyPairPath: string) {
    if (!fs.existsSync(keyPairPath)) {
      const keyPair = ec.genKeyPair()
      this.keyPairData = {
        publicKey: keyPair.getPublic(true, 'hex'),
        privateKey: keyPair.getPrivate('hex')
      }

      // 0o600 sets read/write permissions for owner only (no access for group/others)
      fs.writeFileSync(keyPairPath, JSON.stringify(this.keyPairData, null, 2), { mode: 0o600 })
    } else {
      const keyPairData = KeyPairSchema.parse(JSON.parse(fs.readFileSync(keyPairPath, 'utf-8')))
      this.keyPairData = keyPairData
    }
  }

  async sign(message: string): Promise<string> {
    const keyPair = ec.keyFromPrivate(this.keyPairData.privateKey, 'hex')
    const msgHash = createHash('sha256').update(message).digest()
    const signature = keyPair.sign(msgHash)
    return signature.toDER('hex')
  }

  public decrypt(combinedPayload: string): string {
    const ephemPublicKey = combinedPayload.slice(0, 66)
    const encrypted = combinedPayload.slice(66)

    const sharedSecret = ec
      .keyFromPrivate(this.keyPairData.privateKey, 'hex')
      .derive(ec.keyFromPublic(ephemPublicKey, 'hex').getPublic())

    const encryptionKey = createHash('sha256').update(sharedSecret.toString(16)).digest()

    const iv = Buffer.from(encrypted.slice(0, 32), 'hex')
    const encryptedContent = encrypted.slice(32)

    const decipher = createDecipheriv('aes-256-cbc', encryptionKey, iv)
    let decrypted = decipher.update(encryptedContent, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  }
}
