import * as net from 'net';
import { EventEmitter } from 'events';
import { Logger } from 'homebridge';
import { v4 as uuidv4 } from 'uuid';

export interface DeakoDevice {
  uuid: string;
  name: string;
  isDimmer: boolean;
  power: boolean;
  brightness: number; // 0-100
}

export interface DeakoStateChange {
  uuid: string;
  power: boolean;
  brightness: number;
}

type DeakoMessageData = Record<string, unknown>;

interface DeakoMessage {
  transactionId?: string;
  type: string;
  dst?: string;
  src?: string;
  timestamp?: number;
  status?: string;
  data?: DeakoMessageData;
}

const RATE_LIMIT_MS = 800;
const CRLF = '\r\n';

export class DeakoClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastSentAt = 0;
  private sendQueue: string[] = [];
  private sendTimer: NodeJS.Timeout | null = null;
  private connected = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly log: Logger,
    private readonly pingIntervalMs: number,
  ) {
    super();
  }

  connect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.buffer = '';
    this.socket = new net.Socket();
    this.socket.setEncoding('utf8');

    this.socket.on('connect', () => {
      this.connected = true;
      this.log.info(`Connected to Deako bridge at ${this.host}:${this.port}`);
      this.emit('connected');
      this.startPing();
      this.requestDeviceList();
    });

    this.socket.on('data', (data: string) => {
      this.buffer += data;
      this.processBuffer();
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.stopPing();
      this.log.warn('Disconnected from Deako bridge');
      this.emit('disconnected');
    });

    this.socket.on('error', (err) => {
      this.log.error(`Deako socket error: ${err.message}`);
    });

    this.socket.connect(this.port, this.host);
  }

  disconnect(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    this.sendQueue = [];
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setDeviceState(uuid: string, power: boolean, brightness?: number): void {
    const state: Record<string, unknown> = { power };
    if (brightness !== undefined) {
      state['dim'] = brightness;
    }
    this.enqueue({
      transactionId: uuidv4(),
      type: 'CONTROL',
      dst: 'localintegration',
      src: 'homebridge-deako',
      data: {
        target: uuid,
        state,
      },
    });
  }

  requestDeviceList(): void {
    this.enqueue({
      transactionId: uuidv4(),
      type: 'DEVICE_LIST',
      dst: 'localintegration',
      src: 'homebridge-deako',
    });
  }

  private ping(): void {
    this.enqueue({
      transactionId: uuidv4(),
      type: 'PING',
      dst: 'localintegration',
      src: 'homebridge-deako',
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ping(), this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private processBuffer(): void {
    // Messages are CRLF-terminated single-line JSON
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const msg: DeakoMessage = JSON.parse(trimmed);
        this.handleMessage(msg);
      } catch {
        this.log.debug(`Failed to parse Deako message: ${trimmed}`);
      }
    }
  }

  private handleMessage(msg: DeakoMessage): void {
    this.log.debug(`Deako rx: ${JSON.stringify(msg)}`);

    switch (msg.type) {
      case 'DEVICE_LIST':
        this.handleDeviceList(msg);
        break;
      case 'DEVICE_FOUND':
        this.handleDeviceFound(msg);
        break;
      case 'EVENT':
        this.handleEvent(msg);
        break;
      case 'PING': // PONG response has type "PING"
        this.log.debug('Deako pong received');
        break;
      default:
        break;
    }
  }

  private handleDeviceList(msg: DeakoMessage): void {
    if (!msg.data) {
      return;
    }
    const devices = msg.data['devices'] as Array<DeakoMessageData> | undefined;
    if (!Array.isArray(devices)) {
      return;
    }
    const parsed: DeakoDevice[] = devices.map((d) => this.parseDevice(d));
    this.emit('deviceList', parsed);
  }

  private handleDeviceFound(msg: DeakoMessage): void {
    if (!msg.data) {
      return;
    }
    const device = this.parseDevice(msg.data);
    this.emit('deviceFound', device);
  }

  private handleEvent(msg: DeakoMessage): void {
    if (!msg.data || !msg.src) {
      return;
    }
    const eventType = msg.data['eventType'] as string | undefined;
    if (eventType !== 'DEVICE_STATE_CHANGE') {
      return;
    }
    const state = msg.data['state'] as Record<string, unknown> | undefined;
    if (!state) {
      return;
    }
    const change: DeakoStateChange = {
      uuid: msg.src,
      power: !!state['power'],
      brightness: (state['dim'] as number | undefined) ?? 100,
    };
    this.emit('deviceStateChange', change);
  }

  private parseDevice(d: DeakoMessageData): DeakoDevice {
    const capabilities = d['capabilities'] as string | undefined;
    return {
      uuid: d['uuid'] as string,
      name: (d['name'] as string | undefined) ?? 'Deako Device',
      isDimmer: capabilities === 'power+dim',
      power: !!((d['state'] as Record<string, unknown> | undefined)?.['power']),
      brightness: ((d['state'] as Record<string, unknown> | undefined)?.['dim'] as number | undefined) ?? 100,
    };
  }

  private enqueue(msg: DeakoMessage): void {
    this.sendQueue.push(JSON.stringify(msg) + CRLF);
    this.scheduleSend();
  }

  private scheduleSend(): void {
    if (this.sendTimer) {
      return;
    }
    const now = Date.now();
    const delay = Math.max(0, RATE_LIMIT_MS - (now - this.lastSentAt));
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.flushQueue();
    }, delay);
  }

  private flushQueue(): void {
    const payload = this.sendQueue.shift();
    if (!payload) {
      return;
    }
    if (!this.socket || !this.connected) {
      this.log.warn('Cannot send: not connected to Deako bridge');
      return;
    }
    this.log.debug(`Deako tx: ${payload.trim()}`);
    this.socket.write(payload);
    this.lastSentAt = Date.now();

    if (this.sendQueue.length > 0) {
      this.scheduleSend();
    }
  }
}
