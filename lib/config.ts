import "server-only";
/**
 * Warehouses are defined entirely in .env — no warehouse data lives in code.
 * Adding a third one means adding its key to WAREHOUSES plus a PIN_/NAME_ pair.
 */
export interface Warehouse {
  key: string;
  name: string;
  pin: string;
}

function loadWarehouses(): Warehouse[] {
  const keys = (process.env.WAREHOUSES ?? "")
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error("WAREHOUSES is empty in .env — expected e.g. WAREHOUSES=JNK,MUSCLE_FUSION");
  }

  const warehouses = keys.map((key) => {
    const pin = (process.env[`PIN_${key}`] ?? "").trim();
    const name = (process.env[`NAME_${key}`] ?? "").trim();

    if (!/^\d{4,8}$/.test(pin)) {
      throw new Error(`PIN_${key} in .env must be 4-8 digits`);
    }
    if (!name) {
      throw new Error(`NAME_${key} is missing from .env`);
    }
    return { key, name, pin };
  });

  const pins = new Set(warehouses.map((w) => w.pin));
  if (pins.size !== warehouses.length) {
    throw new Error("Two warehouses share the same PIN in .env — each must be unique");
  }

  return warehouses;
}

export const WAREHOUSES = loadWarehouses();

export function warehouseByPin(pin: string): Warehouse | undefined {
  return WAREHOUSES.find((w) => w.pin === pin);
}

export function warehouseByKey(key: string): Warehouse | undefined {
  return WAREHOUSES.find((w) => w.key === key);
}

/** Longest PIN in use — the keypad submits once this many digits are entered. */
export const PIN_LENGTH = Math.max(...WAREHOUSES.map((w) => w.pin.length));


export const TRUSTED_DEVICE_DAYS = Number(process.env.TRUSTED_DEVICE_DAYS ?? 60);
