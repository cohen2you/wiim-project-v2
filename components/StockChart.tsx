'use client';

import { useEffect, useRef } from 'react';

interface StockChartProps {
  ticker: string;
  width?: number;
  height?: number;
}

export default function StockChart({ ticker, width = 600, height = 400 }: StockChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chartRef.current && ticker) {
      // Clear previous chart
      chartRef.current.innerHTML = '';
      
      // Create TradingView widget
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = () => {
        if (chartRef.current) {
          const TradingView = (window as any).TradingView;
          if (TradingView) {
            new TradingView.widget({
              width: width,
              height: height,
              symbol: `NASDAQ:${ticker}`,
              interval: "D",
              timezone: "Etc/UTC",
              theme: "light",
              style: "1",
              locale: "en",
              toolbar_bg: "#f1f3f6",
              enable_publishing: false,
              hide_side_toolbar: false,
              allow_symbol_change: false,
              container_id: chartRef.current.id,
              studies: [],
              show_popup_button: false,
              popup_width: "1000",
              popup_height: "650",
              hide_volume: false,
              save_image: false,
              backgroundColor: "rgba(255, 255, 255, 1)",
              gridColor: "rgba(240, 243, 250, 0)"
            });
          }
        }
      };
      
      document.head.appendChild(script);
    }
  }, [ticker, width, height]);

  return (
    <div 
      ref={chartRef} 
      id={`tradingview-chart-${ticker}`}
      style={{ 
        width: `${width}px`, 
        height: `${height}px`,
        margin: '20px auto',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        overflow: 'hidden'
      }}
    />
  );
} 