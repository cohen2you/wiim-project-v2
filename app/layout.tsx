import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 font-sans text-gray-900 antialiased">
        <div
          style={{
            maxWidth: '768px',
            marginLeft: 'auto',
            marginRight: 'auto',
            border: '4px solid red',  // Remove if you don't want border visible
            padding: '48px',
            boxSizing: 'border-box',
          }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
