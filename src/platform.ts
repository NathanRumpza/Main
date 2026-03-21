import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import Bonjour, { Browser, RemoteService } from 'bonjour-service';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeakoClient, DeakoDevice, DeakoStateChange } from './deakoClient';
import { DeakoAccessory } from './platformAccessory';

const DEAKO_MDNS_TYPE = 'telnet';
const DEAKO_MDNS_NAME = 'local-integration';
const DEFAULT_PORT = 23;

export interface DeakoPlatformConfig extends PlatformConfig {
  discoveryTimeout?: number; // seconds; default 10
  pingInterval?: number;     // seconds; default 10
  reconnectInterval?: number; // seconds; default 15
  refreshInterval?: number;  // seconds; default 300
}

export class DeakoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly accessories: Map<string, DeakoAccessory> = new Map();
  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  public client!: DeakoClient;

  private readonly discoveryTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly reconnectIntervalMs: number;
  private readonly refreshIntervalMs: number;
  private refreshTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly log: Logger,
    public readonly config: DeakoPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.discoveryTimeoutMs = ((config.discoveryTimeout ?? 10) * 1000);
    this.pingIntervalMs = ((config.pingInterval ?? 10) * 1000);
    this.reconnectIntervalMs = ((config.reconnectInterval ?? 15) * 1000);
    this.refreshIntervalMs = ((config.refreshInterval ?? 300) * 1000);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Finished launching, discovering Deako bridge...');
      this.discoverBridge();
    });

    this.api.on('shutdown', () => {
      this.client?.disconnect();
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
      }
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private discoverBridge(): void {
    const bonjour = new Bonjour();
    let resolved = false;

    const browser: Browser = bonjour.find({ type: DEAKO_MDNS_TYPE }, (service: RemoteService) => {
      if (resolved) {
        return;
      }
      if (service.name !== DEAKO_MDNS_NAME) {
        return;
      }

      const host = service.host;
      const port = service.port ?? DEFAULT_PORT;
      resolved = true;
      browser.stop();
      bonjour.destroy();

      this.log.info(`Found Deako bridge at ${host}:${port}`);
      this.setupClient(host, port);
    });

    browser.start();

    setTimeout(() => {
      if (!resolved) {
        browser.stop();
        bonjour.destroy();
        this.log.error(
          `Deako bridge not found after ${this.discoveryTimeoutMs / 1000}s. ` +
          'Ensure the Deako WiFi bridge is powered on and on the same network.',
        );
      }
    }, this.discoveryTimeoutMs);
  }

  private setupClient(host: string, port: number): void {
    this.client = new DeakoClient(host, port, this.log, this.pingIntervalMs);

    this.client.on('connected', () => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.client.on('deviceList', (devices: DeakoDevice[]) => {
      this.log.info(`Discovered ${devices.length} Deako device(s)`);
      this.syncDevices(devices);
      this.startRefreshTimer();
    });

    this.client.on('deviceFound', (device: DeakoDevice) => {
      this.log.info(`New device found: ${device.name}`);
      this.syncDevices([device]);
    });

    this.client.on('deviceStateChange', (change: DeakoStateChange) => {
      const acc = this.accessories.get(change.uuid);
      if (acc) {
        acc.updateState(change.power, change.brightness);
      }
    });

    this.client.on('disconnected', () => {
      this.log.warn(`Will reconnect in ${this.reconnectIntervalMs / 1000}s...`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.log.info('Reconnecting to Deako bridge...');
        this.client.connect();
      }, this.reconnectIntervalMs);
    });

    this.client.connect();
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setInterval(() => {
      this.log.debug('Requesting device list refresh...');
      this.client.requestDeviceList();
    }, this.refreshIntervalMs);
  }

  private syncDevices(devices: DeakoDevice[]): void {
    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.uuid);
      const cached = this.cachedAccessories.get(uuid);

      if (this.accessories.has(device.uuid)) {
        // Already registered — just update state
        this.accessories.get(device.uuid)!.updateState(device.power, device.brightness);
        continue;
      }

      if (cached) {
        this.log.info(`Restoring cached accessory: ${device.name}`);
        const acc = new DeakoAccessory(this, cached, device);
        this.accessories.set(device.uuid, acc);
        this.cachedAccessories.delete(uuid);
      } else {
        this.log.info(`Registering new accessory: ${device.name}`);
        const platformAccessory = new this.api.platformAccessory(device.name, uuid);
        const acc = new DeakoAccessory(this, platformAccessory, device);
        this.accessories.set(device.uuid, acc);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
      }
    }

    // Remove stale cached accessories not present in any device list
    for (const [uuid, accessory] of this.cachedAccessories) {
      this.log.info(`Removing stale accessory: ${accessory.displayName}`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.cachedAccessories.delete(uuid);
    }
  }
}
