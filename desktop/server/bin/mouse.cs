using System;
using System.Runtime.InteropServices;

public class Mouse {
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    static extern bool mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x1000;

    public static void Main(string[] args) {
        string line;
        while ((line = Console.ReadLine()) != null) {
            line = line.Trim().ToLower();
            if (line == "exit") break;
            
            string[] parts = line.Split(' ');
            if (parts.Length == 0) continue;

            string command = parts[0];

            if (command == "move" && parts.Length >= 3) {
                if (int.TryParse(parts[1], out int x) && int.TryParse(parts[2], out int y)) {
                    SetCursorPos(x, y);
                }
            }
            else if (command == "move_rel" && parts.Length >= 3) {
                if (int.TryParse(parts[1], out int dx) && int.TryParse(parts[2], out int dy)) {
                    mouse_event(MOUSEEVENTF_MOVE, (uint)dx, (uint)dy, 0, UIntPtr.Zero);
                }
            } 
            else if (command == "click" && parts.Length >= 2) {
                string button = parts[1];
                if (button == "left") {
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                } else if (button == "right") {
                    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                }
            }
            else if (command == "scroll" && parts.Length >= 3) {
                if (int.TryParse(parts[1], out int dx) && int.TryParse(parts[2], out int dy)) {
                    if (dy != 0) mouse_event(MOUSEEVENTF_WHEEL, 0, 0, dy * 120, UIntPtr.Zero);
                    if (dx != 0) mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, dx * 120, UIntPtr.Zero);
                }
            }
            else if (command == "key" && parts.Length >= 3) {
                if (byte.TryParse(parts[1], out byte vk)) {
                    string action = parts[2]; // down, up, press
                    if (action == "down" || action == "press") keybd_event(vk, 0, 0, UIntPtr.Zero);
                    if (action == "up" || action == "press") keybd_event(vk, 0, 0x0002, UIntPtr.Zero);
                }
            }
        }
    }
}
