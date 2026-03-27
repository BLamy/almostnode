import { loadYoga } from "../../../vendor/opentui/node_modules/yoga-layout/dist/src/load.js";
export * from "../../../vendor/opentui/node_modules/yoga-layout/dist/src/load.js";

type YogaModule = Awaited<ReturnType<typeof loadYoga>>;

let yogaModule: YogaModule | null = null;
let yogaPromise: Promise<YogaModule> | null = null;

export async function preloadYogaLayout(): Promise<YogaModule> {
  if (yogaModule) {
    return yogaModule;
  }

  if (!yogaPromise) {
    yogaPromise = loadYoga().then((loaded) => {
      yogaModule = loaded;
      return loaded;
    });
  }

  return yogaPromise;
}

function getYogaLayout(): YogaModule {
  if (!yogaModule) {
    throw new Error("Yoga layout has not been loaded yet.");
  }

  return yogaModule;
}

const yogaProxy = new Proxy(
  {},
  {
    get(_target, property) {
      return Reflect.get(getYogaLayout() as object, property);
    },
    has(_target, property) {
      return Reflect.has(getYogaLayout() as object, property);
    },
    ownKeys() {
      return Reflect.ownKeys(getYogaLayout() as object);
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(getYogaLayout() as object, property);
    },
  },
) as YogaModule;

export default yogaProxy;
