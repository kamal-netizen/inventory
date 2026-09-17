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

let cached: Warehouse[] | null = null;

/**
 * Read on first use, NOT at import.
 *
 * `next build` evaluates every route module to collect its page data, and a
 * deployment platform injects environment variables when the container starts —
 * long after the build. Parsing at module scope therefore throws during the
 * build with "WAREHOUSES is empty", which reads like a missing setting and is
 * really just a module that cannot be imported without one.
 *
 * Lazy keeps both properties: the build imports this file happily, and the
 * first request still fails loudly and immediately if the config is wrong,
 * rather than serving a half-configured app.
 */
function warehouses(): Warehouse[] {
  return (cached ??= loadWarehouses());
}

export function warehouseByPin(pin: string): Warehouse | undefined {
  return warehouses().find((w) => w.pin === pin);
}

export function warehouseByKey(key: string): Warehouse | undefined {
  return warehouses().find((w) => w.key === key);
}

/** Longest PIN in use — the keypad submits once this many digits are entered. */
export function pinLength(): number {
  return Math.max(...warehouses().map((w) => w.pin.length));
}

export function trustedDeviceDays(): number {
  return Number(process.env.TRUSTED_DEVICE_DAYS ?? 60);
}
