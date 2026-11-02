import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeSvg({ value, size = 200, className = '' }: QrCodeSvgProps) {
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toString(value, {
      type: 'svg',
      margin: 1,
      width: size,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
    })
      .then((svg) => {
        if (active) setSvgContent(svg);
      })
      .catch((err) => {
        console.error('Failed to generate QR code SVG:', err);
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!svgContent) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-50 text-slate-400 text-xs rounded border border-slate-200 ${className}`}
        style={{ width: size, height: size }}
      >
        Membuat QR...
      </div>
    );
  }

  return (
    <div
      className={`inline-block overflow-hidden rounded border border-slate-200 bg-white p-2 ${className}`}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}

