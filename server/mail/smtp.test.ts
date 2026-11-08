import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mailConfigFromEnv, sendMail } from './smtp';

let server: net.Server | undefined;
afterEach(() => server?.close());

/** SMTP de mentira: responde ao roteiro e guarda o que recebeu. */
function fakeSmtp(): Promise<{ port: number; got: string[] }> {
  const got: string[] = [];
  return new Promise((ok) => {
    server = net.createServer((s) => {
      s.on('error', () => {});
      s.setEncoding('utf8');
      let data = false;
      let buf = '';
      s.write('220 fake\r\n');
      s.on('data', (d: string) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          got.push(line);
          if (data) {
            if (line === '.') {
              data = false;
              s.write('250 queued\r\n');
            }
          } else if (line.startsWith('EHLO')) s.write('250-fake\r\n250 8BITMIME\r\n');
          else if (line === 'DATA') {
            data = true;
            s.write('354 go\r\n');
          } else if (line === 'QUIT') s.end('221 bye\r\n');
          else s.write('250 ok\r\n');
        }
      });
    }).listen(0, '127.0.0.1', () => ok({ port: (server!.address() as net.AddressInfo).port, got }));
  });
}

describe('smtp', () => {
  it('lê a configuração do ambiente (HABBLAUD_ vale mais que o genérico; sem host = desligado)', () => {
    expect(mailConfigFromEnv({})).toBeUndefined();
    expect(mailConfigFromEnv({ SMTP_HOST: 'smtp.x.com', SMTP_USER: 'a@x.com', SMTP_PASS: 'p', HABBLAUD_SMTP_PORT: '465' })).toEqual({
      host: 'smtp.x.com', port: 465, user: 'a@x.com', pass: 'p', from: 'a@x.com', secure: true,
    });
    expect(mailConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '587' })).toBeUndefined(); // sem remetente
  });

  it('envia uma mensagem (envelope, assunto em UTF-8 e corpo em base64)', async () => {
    const { port, got } = await fakeSmtp();
    await sendMail({ host: '127.0.0.1', port, from: 'DevLand <no@devland.test>', secure: false }, { to: 'ana@exemplo.com', subject: 'Redefinir a senha', text: 'oi\n.ponto' });
    expect(got).toContain('MAIL FROM:<no@devland.test>');
    expect(got).toContain('RCPT TO:<ana@exemplo.com>');
    const head = got.join('\n');
    expect(head).toContain('Subject: =?UTF-8?B?');
    expect(Buffer.from(got.find((l) => /^[A-Za-z0-9+/=]{8,}$/.test(l) && !l.startsWith('EHLO')) ?? '', 'base64').toString()).toContain('oi');
  });

  it('não manda senha sem TLS', async () => {
    const { port } = await fakeSmtp();
    await expect(sendMail({ host: '127.0.0.1', port, user: 'u', pass: 'p', from: 'a@b.co', secure: false }, { to: 'x@y.co', subject: 's', text: 't' })).rejects.toThrow(/STARTTLS/);
  });
});
