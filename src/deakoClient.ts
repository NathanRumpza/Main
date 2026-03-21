import * as net from 'net';
import { EventEmitter } from 'events';
import { Logger } from 'homebridge';

export interface DeakoDevice {
  uuid: string;
  name: string;
  isDimmer: boolean;
  power: boolean;
  brightness: number; // 0-100
}

interface DeakoMessage {
  transactionId: string;
  type: string;
  dst: string;
  src: string;
  payload?: Record<string, unknown>;
}

export class DeakoClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private transactionCounter = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly RECONNECT_DELAY_MS = 5000;
  private connected = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly log: Logger,
  ) {
    super();
  }

  connect(): void {
    if (this.socket) {
      this.socket.destroy();
    }

    this.socket = new net.Socket();
    this.socket.setEncoding('utf8');

    this.socket.on('connect', () => {
      this.connected = true;
      this.log.info(`Connected to Deako hub at ${this.host}:${this.port}`);
      this.emit('connected');
      this.requestDeviceList();
    });

    this.socket.on('data', (data: string) => {
      this.buffer += data;
      this.processBuffer();
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.log.warn('Disconnected from Deako hub, will reconnect...');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.socket.on('error', (err) => {
      this.log.error(`Deako socket error: ${err.message}`);
    });

    this.socket.connect(this.port, this.host);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setDeviceState(uuid: string, power: boolean, brightness?: number): void {
    const payload: Record<string, unknown> = { power };
    if (brightness !== undefined) {
      payload.dim = brightness;
    }

    this.sendMessage({
      transactionId: this.nextTransactionId(),
      type: 'CONTROL',
      dst: uuid,
      src: 'homebridge-deako',
      payload,
    });
  }

  requestDeviceList(): void {
    this.sendMessage({
      transactionId: this.nextTransactionId(),
      type: 'DEVICE_LIST',
      dst: 'deako',
      src: 'homebridge-deako',
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep incomplete line in buffer
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
    this.log.debug(`Received Deako message: ${JSON.stringify(msg)}`);

    switch (msg.type) {
      case 'DEVICE_LIST':
        this.handleDeviceList(msg);
        break;
      case 'EVENT':
        this.handleEvent(msg);
        break;
      default:
        break;
    }
  }

  private handleDeviceList(msg: DeakoMessage): void {
    if (!msg.payload) {
      return;
    }
    const devices = msg.payload['devices'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(devices)) {
      return;
    }

    const parsed: DeakoDevice[] = devices.map((d) => ({
      uuid: d['uuid'] as string,
      name: d['name'] as string,
      isDimmer: !!(d['capabilities'] as Record<string, unknown> | undefined)?.['dim'],
      power: !!(d['state'] as Record<string, unknown> | undefined)?.['power'],
      brightness: ((d['state'] as Record<string, unknown> | undefined)?.['dim'] as number | undefined) ?? 100,
    }));

    this.emit('deviceList', parsed);
  }

  private handleEvent(msg: DeakoMessage): void {
    if (!msg.payload || !msg.src) {
      return;
    }
    const state = msg.payload['state'] as Record<string, unknown> | undefined;
    if (!state) {
      return;
    }

    this.emit('deviceStateChange', {
      uuid: msg.src,
      power: !!state['power'],
      brightness: (state['dim'] as number | undefined) ?? 100,
    });
  }

  private sendMessage(msg: DeakoMessage): void {
    if (!this.socket || !this.connected) {
      this.log.warn('Cannot send message: not connected to Deako hub');
      return;
    }
    const payload = JSON.stringify(msg) + '\n';
    this.socket.write(payload);
  }

  private nextTransactionId(): string {
    return `hb-${++this.transactionCounter}`;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.log.info('Attempting to reconnect to Deako hub...');
      this.connect();
    }, this.RECONNECT_DELAY_MS);
  }
}
