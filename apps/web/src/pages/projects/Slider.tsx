/** A slider with its value written beside it. */
export function Slider({
  label,
  intro,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  intro?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange(v: number): void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[13px] font-medium text-zinc-700">
        {label}
        <span className="font-normal text-zinc-500 tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      {intro && <span className="mb-1.5 block text-xs text-zinc-500">{intro}</span>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent-600"
      />
    </label>
  );
}
