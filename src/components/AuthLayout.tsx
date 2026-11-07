export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center p-6 bg-[#fafafa]">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}