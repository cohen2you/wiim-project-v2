import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body 
        className="bg-gray-50 font-sans text-gray-900 antialiased"
        suppressHydrationWarning={true}
      >
        {children}
      </body>
    </html>
  );
}
