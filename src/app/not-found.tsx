import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid place-items-center gap-2 py-24 text-center">
      <h1 className="text-20 font-medium">Account not found</h1>
      <p className="text-mute">It is not in the latest run.</p>
      <Link href="/" className="text-link hover:underline">Back to the ranking</Link>
    </div>
  );
}
