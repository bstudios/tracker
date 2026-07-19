export const DEVICE_ICON_OPTIONS = [
  { value: "IconCar", label: "Car" },
  { value: "IconTruck", label: "Truck" },
  { value: "IconBike", label: "Bike" },
  { value: "IconMotorbike", label: "Motorbike" },
  { value: "IconBus", label: "Bus" },
  { value: "IconTrain", label: "Train" },
  { value: "IconSpeedboat", label: "Speedboat" },
  { value: "IconSailboat", label: "Sailboat" },
  { value: "IconShip", label: "Ship" },
  { value: "IconPlane", label: "Plane" },
  { value: "IconHelicopter", label: "Helicopter" },
] as const;

export type DeviceIconName = (typeof DEVICE_ICON_OPTIONS)[number]["value"];

export const DEFAULT_DEVICE_ICON: DeviceIconName = "IconCar";

export const isDeviceIconName = (value: string): value is DeviceIconName =>
  DEVICE_ICON_OPTIONS.some((option) => option.value === value);
