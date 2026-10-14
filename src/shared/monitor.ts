export const monitorBaudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
export interface MonitorState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  port: string
  baud: number
  log: string
  error?: string
}
