interface SpinnerProps {
  label?: string;
  small?: boolean;
}

export default function Spinner({ label, small }: SpinnerProps) {
  return (
    <span className="spinner-wrap">
      <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-hidden />
      {label ? <span className="spinner-label">{label}</span> : null}
    </span>
  );
}
