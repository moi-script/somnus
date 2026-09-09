import { SerialPort } from 'serialport';

// `npm run list -w @lacs/serial-bridge` - find the COM port for SERIAL_PORT.
const ports = await SerialPort.list();

if (ports.length === 0) {
  console.log('No serial ports found. Is the XIAO plugged in?');
} else {
  for (const p of ports) {
    // friendlyName is Windows-only and absent from the cross-platform type.
    const label = (p as { friendlyName?: string }).friendlyName ?? '';
    console.log([p.path, p.manufacturer ?? 'unknown', label].join('\t'));
  }
}
