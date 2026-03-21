import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeakoClient, DeakoDevice } from './deakoClient';
import { DeakoAccessory } from './platformAccessory';

export class DeakoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly accessories: Map<string, DeakoAccessory> = new Map();
  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  public readonly client: DeakoClient;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    const host: string = config['host'] ?? '192.168.1.100';
    const port: number = config['port'] ?? 23;

    this.client = new DeakoClient(host, port, log);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Finished launching, connecting to Deako hub...');
      this.setupClientListeners();
      this.client.connect();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private setupClientListeners(): void {
    this.client.on('deviceList', (devices: DeakoDevice[]) => {
      this.log.info(`Discovered ${devices.length} Deako device(s)`);
      this.syncDevices(devices);
    });

    this.client.on('deviceStateChange', ({ uuid, power, brightness }: { uuid: string; power: boolean; brightness: number }) => {
      const accessory = this.accessories.get(uuid);
      if (accessory) {
        accessory.updateState(power, brightness);
      }
    });

    this.client.on('disconnected', () => {
      this.log.warn('Lost connection to Deako hub');
    });

    this.client.on('connected', () => {
      this.log.info('Connected to Deako hub');
    });
  }

  private syncDevices(devices: DeakoDevice[]): void {
    const activeUUIDs = new Set<string>();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.uuid);
      activeUUIDs.add(uuid);

      const cached = this.cachedAccessories.get(uuid);

      if (cached) {
        this.log.info(`Restoring cached accessory: ${device.name}`);
        const acc = new DeakoAccessory(this, cached, device);
        this.accessories.set(device.uuid, acc);
      } else {
        this.log.info(`Adding new accessory: ${device.name}`);
        const platformAccessory = new this.api.platformAccessory(device.name, uuid);
        const acc = new DeakoAccessory(this, platformAccessory, device);
        this.accessories.set(device.uuid, acc);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
      }
    }

    // Remove accessories that are no longer present
    for (const [uuid, accessory] of this.cachedAccessories) {
      if (!activeUUIDs.has(uuid)) {
        this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.delete(uuid);
      }
    }
  }
}
