import { BatteryFull, Signal, Wifi } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Cutout = 'island' | 'punch' | 'button' | 'camera';
type Sides = { top: number; right: number; bottom: number; left: number };

export interface DeviceModel {
  id: string;
  kind: 'phone' | 'tablet';
  name: string;
  /** Screen size in CSS pixels, portrait: what the page sees as its viewport. */
  w: number;
  h: number;
  /** Screen corner radius. */
  radius: number;
  /** Body thickness around the screen, portrait. */
  bezel: Sides;
  /** Status bar height. */
  statusBar: number;
  cutout: Cutout;
  /** Width of the Dynamic Island, or diameter of the punch-hole camera. */
  cutoutSize?: number;
  homeIndicator: boolean;
  /** Body colour. */
  body: string;
}

const even = (n: number): Sides => ({ top: n, right: n, bottom: n, left: n });

export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: 'iphone-16-pro-max',
    kind: 'phone',
    name: 'iPhone 16 Pro Max',
    w: 440,
    h: 956,
    radius: 62,
    bezel: even(11),
    statusBar: 54,
    cutout: 'island',
    cutoutSize: 126,
    homeIndicator: true,
    body: '#4a4846',
  },
  {
    id: 'iphone-16-pro',
    kind: 'phone',
    name: 'iPhone 16 Pro',
    w: 402,
    h: 874,
    radius: 55,
    bezel: even(11),
    statusBar: 54,
    cutout: 'island',
    cutoutSize: 126,
    homeIndicator: true,
    body: '#4a4846',
  },
  {
    id: 'iphone-16',
    kind: 'phone',
    name: 'iPhone 16',
    w: 393,
    h: 852,
    radius: 55,
    bezel: even(11),
    statusBar: 54,
    cutout: 'island',
    cutoutSize: 126,
    homeIndicator: true,
    body: '#26272b',
  },
  {
    id: 'iphone-se',
    kind: 'phone',
    name: 'iPhone SE',
    w: 375,
    h: 667,
    radius: 0,
    bezel: { top: 64, right: 14, bottom: 72, left: 14 },
    statusBar: 20,
    cutout: 'button',
    homeIndicator: false,
    body: '#1d1d1f',
  },
  {
    id: 'pixel-9',
    kind: 'phone',
    name: 'Google Pixel 9',
    w: 412,
    h: 923,
    radius: 42,
    bezel: even(9),
    statusBar: 40,
    cutout: 'punch',
    cutoutSize: 18,
    homeIndicator: true,
    body: '#2c2f33',
  },
  {
    id: 'galaxy-s24',
    kind: 'phone',
    name: 'Samsung Galaxy S24',
    w: 360,
    h: 780,
    radius: 30,
    bezel: even(8),
    statusBar: 36,
    cutout: 'punch',
    cutoutSize: 13,
    homeIndicator: true,
    body: '#232427',
  },
  {
    id: 'ipad-10',
    kind: 'tablet',
    name: 'iPad (10th gen)',
    w: 820,
    h: 1180,
    radius: 22,
    bezel: even(26),
    statusBar: 34,
    cutout: 'camera',
    homeIndicator: true,
    body: '#d9dadc',
  },
  {
    id: 'ipad-mini',
    kind: 'tablet',
    name: 'iPad mini',
    w: 744,
    h: 1133,
    radius: 20,
    bezel: even(20),
    statusBar: 34,
    cutout: 'camera',
    homeIndicator: true,
    body: '#3a3b3f',
  },
  {
    id: 'ipad-pro-11',
    kind: 'tablet',
    name: 'iPad Pro 11″',
    w: 834,
    h: 1210,
    radius: 18,
    bezel: even(15),
    statusBar: 34,
    cutout: 'camera',
    homeIndicator: true,
    body: '#2a2b2e',
  },
  {
    id: 'ipad-pro-13',
    kind: 'tablet',
    name: 'iPad Pro 13″',
    w: 1032,
    h: 1376,
    radius: 18,
    bezel: even(14),
    statusBar: 34,
    cutout: 'camera',
    homeIndicator: true,
    body: '#2a2b2e',
  },
  {
    id: 'galaxy-tab-s9',
    kind: 'tablet',
    name: 'Galaxy Tab S9',
    w: 800,
    h: 1280,
    radius: 18,
    bezel: even(15),
    statusBar: 36,
    cutout: 'camera',
    homeIndicator: true,
    body: '#2b2d31',
  },
];

export const DEFAULT_MODELS = { phone: 'iphone-16', tablet: 'ipad-10' } as const;
export const modelById = (id: string) =>
  DEVICE_MODELS.find((m) => m.id === id) ?? DEVICE_MODELS[0]!;

/** Turning a device a quarter turn clockwise moves its top to the right, its right to the bottom, and so on. */
const turn = (b: Sides): Sides => ({ top: b.left, right: b.top, bottom: b.right, left: b.bottom });

function StatusBar({ height, accent }: { height: number; accent: string }) {
  return (
    <div
      className={`relative z-10 flex shrink-0 justify-between px-7 text-white ${height > 40 ? 'items-end pb-2' : 'items-center'}`}
      style={{ height, background: accent, boxShadow: `0 1px 0 ${accent}` }}
    >
      <span className="text-[15px] leading-none font-semibold tracking-tight">9:41</span>
      <span className="flex items-center gap-1.5">
        <Signal className="size-3.5" strokeWidth={2.4} />
        <Wifi className="size-3.5" strokeWidth={2.4} />
        <BatteryFull className="size-4" strokeWidth={2} />
      </span>
    </div>
  );
}

/**
 * A device body around the preview. The screen is laid out at the model's real
 * size (so the form wraps as it would on that phone) and scaled down to fit.
 */
export function DeviceFrame({
  model,
  landscape,
  accent,
  maxHeight,
  dir,
  children,
}: {
  model: DeviceModel;
  landscape: boolean;
  accent: string;
  maxHeight: number;
  /** Reading direction of what is shown on the screen (the device's own chrome stays as it is). */
  dir?: 'ltr' | 'rtl';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const L = landscape;
  const bz = L ? turn(model.bezel) : model.bezel;
  const sw = L ? model.h : model.w;
  const sh = L ? model.w : model.h;
  const ow = sw + bz.left + bz.right;
  const oh = sh + bz.top + bz.bottom;
  const scale = avail ? Math.min(1, avail / ow, maxHeight / oh) : 1;
  const phone = model.kind === 'phone';
  const bodyRadius =
    model.radius +
    Math.min(bz.top, bz.right, bz.bottom, bz.left) +
    (model.cutout === 'button' ? 36 : 0);
  // Phones in landscape drop the status bar and keep clear of the island.
  const statusBar = L && phone ? 0 : model.statusBar;
  const inset = L && model.cutout === 'island' ? 48 : 0;
  const darkBody = !/^#d/.test(model.body);

  /** Places a part of the body on the portrait side `side`, wherever the turn put it. */
  const edge = (side: 'top' | 'bottom' | 'left' | 'right') => {
    const to = L
      ? ({ top: 'right', right: 'bottom', bottom: 'left', left: 'top' } as const)[side]
      : side;
    return to;
  };
  /** Side buttons, portrait only: `from` and `length` are fractions of the body's height. */
  const buttonStyle = (side: 'left' | 'right', from: number, length: number) => ({
    position: 'absolute' as const,
    top: `${from * 100}%`,
    height: `${length * oh}px`,
    width: 4,
    [side]: -4,
    background: model.body,
    filter: 'brightness(.8)',
    borderRadius: 2,
  });
  // Where the camera, speaker and home button sit on the body.
  const slot = (side: 'top' | 'bottom', size: { w: number; h: number }) => {
    const to = edge(side);
    const vertical = to === 'left' || to === 'right';
    const w = vertical ? size.h : size.w;
    const h = vertical ? size.w : size.h;
    const bezel = bz[to];
    const style: Record<string, number | string> = { position: 'absolute', width: w, height: h };
    if (vertical) {
      style.top = oh / 2 - h / 2;
      style[to] = bezel / 2 - w / 2;
    } else {
      style.left = ow / 2 - w / 2;
      style[to] = bezel / 2 - h / 2;
    }
    return style;
  };

  return (
    <div ref={ref} className="w-full">
      <div className="mx-auto" style={{ width: ow * scale, height: oh * scale }}>
        <div
          className="relative"
          style={{
            width: ow,
            height: oh,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {!L && (
            <>
              <i style={buttonStyle('right', 0.2, 0.09)} />
              <i style={buttonStyle('left', 0.14, 0.04)} />
              <i style={buttonStyle('left', 0.22, 0.07)} />
              <i style={buttonStyle('left', 0.31, 0.07)} />
            </>
          )}
          <div
            className="absolute inset-0"
            style={{
              background: model.body,
              borderRadius: bodyRadius,
              boxShadow:
                'inset 0 0 0 2px rgb(255 255 255 / .12), inset 0 0 0 5px rgb(0 0 0 / .35), 0 18px 40px rgb(0 0 0 / .28)',
            }}
          >
            {model.cutout === 'button' && (
              <>
                <i className="rounded-full bg-black/55" style={slot('top', { w: 56, h: 6 })} />
                <i
                  className="rounded-full border-2"
                  style={{
                    ...slot('bottom', { w: 46, h: 46 }),
                    borderColor: darkBody ? 'rgb(255 255 255 / .28)' : 'rgb(0 0 0 / .25)',
                  }}
                />
              </>
            )}
            {model.cutout === 'camera' && (
              <i className="rounded-full bg-black/70" style={slot('top', { w: 7, h: 7 })} />
            )}
          </div>
          <div
            className="absolute flex flex-col overflow-hidden bg-canvas"
            style={{
              left: bz.left,
              top: bz.top,
              width: sw,
              height: sh,
              borderRadius: model.radius,
            }}
          >
            {statusBar > 0 && <StatusBar height={statusBar} accent={accent} />}
            <div
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
              style={{ paddingLeft: inset, paddingRight: inset }}
            >
              <div dir={dir}>{children}</div>
              {model.homeIndicator && <div aria-hidden style={{ height: 28 }} />}
            </div>
            {model.homeIndicator && (
              <i
                aria-hidden
                className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-zinc-900/80"
              />
            )}
            {model.cutout === 'island' &&
              (L ? (
                <i
                  aria-hidden
                  className="absolute left-3 rounded-full bg-black"
                  style={{ top: sh / 2 - 63, width: 37, height: 126 }}
                />
              ) : (
                <i
                  aria-hidden
                  className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
                  style={{ top: 11, width: model.cutoutSize, height: 37 }}
                />
              ))}
            {model.cutout === 'punch' &&
              (L ? (
                <i
                  aria-hidden
                  className="absolute left-3 rounded-full bg-black"
                  style={{
                    top: sh / 2 - (model.cutoutSize ?? 14) / 2,
                    width: model.cutoutSize,
                    height: model.cutoutSize,
                  }}
                />
              ) : (
                <i
                  aria-hidden
                  className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
                  style={{ top: 12, width: model.cutoutSize, height: model.cutoutSize }}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
