import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { DeakoDevice } from './deakoClient';
import { DeakoPlatform } from './platform';

export class DeakoAccessory {
  private service: Service;
  private state: {
    on: boolean;
    brightness: number;
  };

  constructor(
    private readonly platform: DeakoPlatform,
    private readonly accessory: PlatformAccessory,
    private device: DeakoDevice,
  ) {
    this.state = {
      on: device.power,
      brightness: device.brightness,
    };

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Deako')
      .setCharacteristic(this.platform.Characteristic.Model, device.isDimmer ? 'Dimmer' : 'Switch')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.uuid);

    // Use Lightbulb service for both switches and dimmers
    this.service = this.accessory.getService(this.platform.Service.Lightbulb)
      || this.accessory.addService(this.platform.Service.Lightbulb);

    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    // On/Off characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    // Brightness characteristic for dimmers only
    if (device.isDimmer) {
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onGet(this.handleBrightnessGet.bind(this))
        .onSet(this.handleBrightnessSet.bind(this));
    }
  }

  updateState(power: boolean, brightness: number): void {
    this.state.on = power;
    this.state.brightness = brightness;

    this.service.updateCharacteristic(this.platform.Characteristic.On, power);
    if (this.device.isDimmer) {
      this.service.updateCharacteristic(this.platform.Characteristic.Brightness, brightness);
    }
  }

  private handleOnGet(): CharacteristicValue {
    return this.state.on;
  }

  private handleOnSet(value: CharacteristicValue): void {
    this.state.on = value as boolean;
    this.platform.log.debug(`Set ${this.device.name} On -> ${value}`);
    this.platform.client.setDeviceState(
      this.device.uuid,
      this.state.on,
      this.device.isDimmer ? this.state.brightness : undefined,
    );
  }

  private handleBrightnessGet(): CharacteristicValue {
    return this.state.brightness;
  }

  private handleBrightnessSet(value: CharacteristicValue): void {
    this.state.brightness = value as number;
    this.platform.log.debug(`Set ${this.device.name} Brightness -> ${value}`);
    this.platform.client.setDeviceState(this.device.uuid, this.state.on, this.state.brightness);
  }
}
