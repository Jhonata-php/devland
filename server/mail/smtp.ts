// Envio de e-mail por SMTP, sem dependências (node:net e node:tls). Serve só para o "esqueci a senha" do Cloud: uma
// mensagem de texto por vez, autenticação PLAIN/LOGIN, TLS implícito (porta 465) ou STARTTLS (587 e outras).
// Configuração pelo ambiente (o nome com DEVLAND_ vale mais que o genérico; apelidos MAIL_* e EMAIL_* também valem):
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS (ou SMTP_PASSWORD), SMTP_FROM (padrão: SMTP_USER), SMTP_SECURE (1 = TLS implícito)
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export interface MailConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

const TIMEOUT_MS = 15_000;

export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig | undefined {
  // Cada item aceita o nome com DEVLAND_ na frente e os apelidos mais comuns (SMTP_*, MAIL_*, EMAIL_*).
  const pick = (...names: string[]) => {
    for (const n of names) {
      const v = (env[`DEVLAND_${n}`] ?? env[n])?.trim();
      if (v) return v;
    }
    return undefined;
  };
  const host = pick('SMTP_HOST', 'SMTP_SERVER', 'MAIL_HOST', 'EMAIL_HOST');
  if (!host) return undefined;
  const port = Number(pick('SMTP_PORT', 'MAIL_PORT', 'EMAIL_PORT') ?? 587);
  const user = pick('SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER', 'MAIL_USERNAME', 'EMAIL_USER');
  const from = pick('SMTP_FROM', 'SMTP_FROM_EMAIL', 'MAIL_FROM', 'EMAIL_FROM') ?? user;
  if (!from || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const secureEnv = pick('SMTP_SECURE', 'SMTP_SSL', 'MAIL_SECURE');
  return { host, port, user, pass: pick('SMTP_PASS', 'SMTP_PASSWORD', 'MAIL_PASSWORD', 'EMAIL_PASSWORD'), from, secure: secureEnv ? /^(1|true|yes|on)$/i.test(secureEnv) : port === 465 };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer | undefined {
  const cfg = mailConfigFromEnv(env);
  return cfg ? { send: (mail) => sendMail(cfg, mail) } : undefined;
}

/** "Nome <a@b.c>" ou "a@b.c" → só o endereço (para o envelope). */
const addressOf = (v: string): string => /<([^>]+)>/.exec(v)?.[1] ?? v.trim();
const clean = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim();

class Conn {
  private buf = '';
  private waiter?: (code: number, lines: string[]) => void;
  private lines: string[] = [];
  private fail?: (e: Error) => void;

  constructor(public sock: net.Socket) {
    this.attach();
  }

  private attach(): void {
    this.sock.setEncoding('utf8');
    this.sock.setTimeout(TIMEOUT_MS, () => this.sock.destroy(new Error('SMTP: tempo esgotado')));
    this.sock.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.lines.push(line);
        // "250-..." continua; "250 ..." termina a resposta
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const lines = this.lines;
          this.lines = [];
          this.waiter?.(Number(line.slice(0, 3)), lines);
          this.waiter = undefined;
        }
      }
    });
    this.sock.on('error', (e) => this.fail?.(e));
    this.sock.on('close', () => this.fail?.(new Error('SMTP: conexão encerrada')));
  }

  /** Troca o socket por um TLS sobre o mesmo (STARTTLS). */
  upgrade(host: string): Promise<void> {
    return new Promise((ok, no) => {
      const s = tls.connect({ socket: this.sock, servername: net.isIP(host) ? undefined : host }, () => {
        this.sock = s;
        this.buf = '';
        this.attach();
        ok();
      });
      s.once('error', no);
    });
  }

  read(): Promise<{ code: number; lines: string[] }> {
    return new Promise((ok, no) => {
      this.fail = no;
      this.waiter = (code, lines) => ok({ code, lines });
    });
  }

  async cmd(line: string, expect: number[]): Promise<string[]> {
    this.sock.write(`${line}\r\n`);
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.lines.at(-1) ?? ''}`.slice(0, 200));
    return r.lines;
  }
}

export async function sendMail(cfg: MailConfig, mail: Mail): Promise<void> {
  const raw: net.Socket = cfg.secure
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: net.isIP(cfg.host) ? undefined : cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  const c = new Conn(raw);
  try {
    const first = await c.read();
    if (first.code !== 220) throw new Error(`SMTP ${first.code}: ${first.lines.at(-1) ?? ''}`.slice(0, 200));
    let caps = (await c.cmd('EHLO devland', [250])).join('\n');
    if (!cfg.secure && /STARTTLS/i.test(caps)) {
      await c.cmd('STARTTLS', [220]);
      await c.upgrade(cfg.host);
      caps = (await c.cmd('EHLO devland', [250])).join('\n');
    } else if (!cfg.secure && cfg.user && cfg.pass) {
      // Nunca manda a senha em texto puro pela rede.
      throw new Error('SMTP: o servidor não oferece STARTTLS; use a porta 465 (SMTP_SECURE=1)');
    }
    if (cfg.user && cfg.pass) {
      if (/AUTH[^\n]*PLAIN/i.test(caps)) await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64')}`, [235]);
      else {
        await c.cmd('AUTH LOGIN', [334]);
        await c.cmd(Buffer.from(cfg.user).toString('base64'), [334]);
        await c.cmd(Buffer.from(cfg.pass).toString('base64'), [235]);
      }
    }
    await c.cmd(`MAIL FROM:<${addressOf(cfg.from)}>`, [250]);
    await c.cmd(`RCPT TO:<${addressOf(clean(mail.to))}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    const body = mail.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const head = [
      `From: ${clean(cfg.from)}`,
      `To: ${clean(mail.to)}`,
      `Subject: =?UTF-8?B?${Buffer.from(clean(mail.subject)).toString('base64')}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomBytes(12).toString('hex')}@devland>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n');
    const b64 = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    c.sock.write(`${head}\r\n\r\n${b64}\r\n.\r\n`);
    const done = await c.read();
    if (done.code !== 250) throw new Error(`SMTP ${done.code}: ${done.lines.at(-1) ?? ''}`.slice(0, 200));
    c.sock.write('QUIT\r\n');
  } finally {
    c.sock.destroy();
  }
}
