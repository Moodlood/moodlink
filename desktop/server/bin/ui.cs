using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;

namespace MoodLink
{
    static class Program
    {
        [DllImport("kernel32.dll")]
        static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        const int SW_HIDE = 0;

        [STAThread]
        static void Main(string[] args)
        {
            try {
                IntPtr console = GetConsoleWindow();
                if (console != IntPtr.Zero)
                {
                    ShowWindow(console, SW_HIDE);
                }
            } catch {}

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            
            int port = 3847;
            if (args.Length > 0) {
                int p;
                if (int.TryParse(args[0], out p)) {
                    port = p;
                }
            }

            Application.Run(new MainForm(port));
        }
    }

    public class StrokePoint
    {
        public PointF Point;
        public long Timestamp;
        public bool IsNewStroke;
        public Color Color;
    }

    public class MainForm : Form
    {
        private WebView2 webView;
        private int port;
        private NotifyIcon trayIcon;
        private LaserForm laserForm;

        public const int WM_NCLBUTTONDOWN = 0xA1;
        public const int HT_CAPTION = 0x2;
        public const int WM_CLIPBOARDUPDATE = 0x031D;

        [DllImport("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();
        
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool AddClipboardFormatListener(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

        delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        [DllImport("user32.dll")]
        static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

        [DllImport("user32.dll")]
        static extern bool UnhookWinEvent(IntPtr hWinEventHook);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        const uint WINEVENT_OUTOFCONTEXT = 0;

        private WinEventDelegate winEventDelegate;
        private IntPtr hookHandle = IntPtr.Zero;

        public MainForm(int port)
        {
            this.port = port;
            this.Text = "MoodLink";
            this.Width = 1000;
            this.Height = 700;
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(0, 0, 0); // Strict Black
            try {
                string iconPath = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(Application.ExecutablePath), "icon.ico");
                if (System.IO.File.Exists(iconPath)) {
                    this.Icon = new Icon(iconPath);
                } else {
                    this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                }
            } catch {
                this.Icon = SystemIcons.Application;
            }

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            this.Controls.Add(webView);
            
            InitializeTray();
            InitializeAsync();
            StartStdinReader();
            InitializeNativeHooks();
        }

        private void InitializeNativeHooks()
        {
            try {
                AddClipboardFormatListener(this.Handle);
            } catch {}

            try {
                winEventDelegate = new WinEventDelegate(WinEventProc);
                hookHandle = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, winEventDelegate, 0, 0, WINEVENT_OUTOFCONTEXT);
            } catch {}
        }

        private void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            if (eventType == EVENT_SYSTEM_FOREGROUND && hwnd != IntPtr.Zero)
            {
                try {
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);
                    if (pid > 0) {
                        var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                        string procName = proc.ProcessName.ToLower();
                        Console.WriteLine("app_foreground " + procName);
                    }
                } catch {}
            }
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WM_CLIPBOARDUPDATE)
            {
                HandleClipboardUpdate();
            }
        }

        private void HandleClipboardUpdate()
        {
            try {
                if (Clipboard.ContainsImage()) {
                    Image img = Clipboard.GetImage();
                    if (img != null) {
                        string userDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                        string clipboardDir = System.IO.Path.Combine(userDir, "Downloads", "MoodLinkUploads", "clipboard");
                        if (!System.IO.Directory.Exists(clipboardDir)) {
                            System.IO.Directory.CreateDirectory(clipboardDir);
                        }
                        string filename = "pc_snip_" + DateTime.Now.Ticks + ".png";
                        string fullPath = System.IO.Path.Combine(clipboardDir, filename);
                        img.Save(fullPath, System.Drawing.Imaging.ImageFormat.Png);
                        img.Dispose();
                        Console.WriteLine("clipboard_image_captured " + filename);
                    }
                }
            } catch {}
        }

        private void InitializeTray()
        {
            trayIcon = new NotifyIcon();
            trayIcon.Text = "MoodLink — Running";
            trayIcon.Icon = this.Icon;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => {
                this.Show();
                this.WindowState = FormWindowState.Normal;
                this.BringToFront();
            };

            var contextMenu = new ContextMenu();
            contextMenu.MenuItems.Add("Open MoodLink", (s, e) => {
                this.Show();
                this.WindowState = FormWindowState.Normal;
                this.BringToFront();
            });
            contextMenu.MenuItems.Add("-");
            contextMenu.MenuItems.Add("Quit MoodLink", (s, e) => {
                trayIcon.Visible = false;
                Application.Exit();
                Environment.Exit(0);
            });
            trayIcon.ContextMenu = contextMenu;
        }

        private void EnsureLaserForm()
        {
            if (laserForm == null || laserForm.IsDisposed)
            {
                laserForm = new LaserForm();
            }
            if (!laserForm.Visible)
            {
                laserForm.Show();
            }
        }

        private void ShowLaser(float x, float y)
        {
            EnsureLaserForm();
            laserForm.UpdatePosition(x, y);
        }

        private void HideLaser()
        {
            if (laserForm != null && !laserForm.IsDisposed)
            {
                laserForm.HidePointer();
            }
        }

        private void StartStdinReader()
        {
            Thread t = new Thread(() => {
                while (true)
                {
                    string line = Console.ReadLine();
                    if (line == null) break; // EOF
                    line = line.Trim();
                    
                    try {
                        if (line.StartsWith("tray_status "))
                        {
                            string status = line.Substring(12);
                            this.Invoke((MethodInvoker)delegate {
                                trayIcon.Text = "MoodLink — " + status;
                            });
                        }
                        else if (line.StartsWith("laser_move "))
                        {
                            var parts = line.Split(' ');
                            if (parts.Length == 3) {
                                float x = float.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
                                float y = float.Parse(parts[2], System.Globalization.CultureInfo.InvariantCulture);
                                this.Invoke((MethodInvoker)delegate {
                                    ShowLaser(x, y);
                                });
                            }
                        }
                        else if (line == "laser_hide")
                        {
                            this.Invoke((MethodInvoker)delegate {
                                HideLaser();
                            });
                        }
                        else if (line.StartsWith("ink_point "))
                        {
                            // ink_point rx ry isNew colorType
                            var parts = line.Split(' ');
                            if (parts.Length >= 5) {
                                float rx = float.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
                                float ry = float.Parse(parts[2], System.Globalization.CultureInfo.InvariantCulture);
                                bool isNew = parts[3] == "1";
                                int col = int.Parse(parts[4]);
                                this.Invoke((MethodInvoker)delegate {
                                    EnsureLaserForm();
                                    laserForm.AddInkPoint(rx, ry, isNew, col);
                                });
                            }
                        }
                        else if (line == "ink_clear")
                        {
                            this.Invoke((MethodInvoker)delegate {
                                if (laserForm != null && !laserForm.IsDisposed) laserForm.ClearInk();
                            });
                        }
                    } catch (Exception) { }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        async void InitializeAsync()
        {
            var env = await CoreWebView2Environment.CreateAsync(null, System.IO.Path.GetTempPath());
            await webView.EnsureCoreWebView2Async(env);
            
            webView.CoreWebView2.Navigate(string.Format("http://localhost:{0}", port));
            webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
            
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
                window.addEventListener('mousedown', function(e) {
                    if (e.target.closest('#btn-close') || e.target.closest('.btn-close')) {
                        window.chrome.webview.postMessage('close');
                        return;
                    }
                    if (e.target.closest('#btn-minimize') || e.target.closest('#btn-min') || e.target.closest('.btn-min')) {
                        window.chrome.webview.postMessage('minimize');
                        return;
                    }
                    if (e.target.closest('#btn-maximize') || e.target.closest('#btn-max') || e.target.closest('.btn-max')) {
                        window.chrome.webview.postMessage('maximize');
                        return;
                    }
                    if (e.target.closest('#titlebar') || e.target.closest('.titlebar') || e.target.closest('.titlebar-drag')) {
                        window.chrome.webview.postMessage('drag');
                    }
                });
            ");
        }

        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg = e.TryGetWebMessageAsString();
            if (msg == "drag")
            {
                ReleaseCapture();
                SendMessage(this.Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
            }
            else if (msg == "close")
            {
                this.Hide();
            }
            else if (msg == "minimize")
            {
                this.WindowState = FormWindowState.Minimized;
            }
            else if (msg == "maximize")
            {
                this.WindowState = this.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
            }
            else
            {
                try {
                    RemoveClipboardFormatListener(this.Handle);
                    if (hookHandle != IntPtr.Zero) UnhookWinEvent(hookHandle);
                } catch {}
                trayIcon.Visible = false;
            }
        }
    }

    public class LaserForm : Form
    {
        private PointF pointerPos;
        private bool showPointer = false;
        private List<StrokePoint> inkPoints = new List<StrokePoint>();
        private System.Windows.Forms.Timer fadeTimer;

        public LaserForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.Bounds = Screen.PrimaryScreen.Bounds;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            
            // Transparent click-through
            this.BackColor = Color.Magenta;
            this.TransparencyKey = Color.Magenta;

            fadeTimer = new System.Windows.Forms.Timer();
            fadeTimer.Interval = 40; // ~25 FPS fade engine
            fadeTimer.Tick += (s, e) => {
                if (inkPoints.Count > 0)
                {
                    long now = Environment.TickCount;
                    // Remove points older than 3.5 seconds
                    inkPoints.RemoveAll(p => (now - p.Timestamp) > 3500);
                    this.Invalidate();
                }
            };
            fadeTimer.Start();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int initialStyle = GetWindowLong(this.Handle, -20);
            SetWindowLong(this.Handle, -20, initialStyle | 0x80000 | 0x20); // WS_EX_LAYERED | WS_EX_TRANSPARENT
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        public void UpdatePosition(float rx, float ry)
        {
            this.pointerPos = new PointF(rx * this.Width, ry * this.Height);
            this.showPointer = true;
            this.Invalidate();
        }

        public void HidePointer()
        {
            this.showPointer = false;
            this.Invalidate();
        }

        public void AddInkPoint(float rx, float ry, bool isNewStroke, int colorType)
        {
            // Strict theme: Neon Yellow #facc15 or Neon Green #22c55e
            Color col = (colorType == 1) ? Color.FromArgb(250, 204, 21) : Color.FromArgb(34, 197, 94);
            lock(inkPoints) {
                inkPoints.Add(new StrokePoint {
                    Point = new PointF(rx * this.Width, ry * this.Height),
                    Timestamp = Environment.TickCount,
                    IsNewStroke = isNewStroke,
                    Color = col
                });
            }
            this.Invalidate();
        }

        public void ClearInk()
        {
            lock(inkPoints) {
                inkPoints.Clear();
            }
            this.Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            
            long now = Environment.TickCount;

            // Render fading ink strokes
            lock(inkPoints)
            {
                for (int i = 1; i < inkPoints.Count; i++)
                {
                    var p1 = inkPoints[i - 1];
                    var p2 = inkPoints[i];
                    if (p2.IsNewStroke) continue;

                    long age = now - p2.Timestamp;
                    if (age >= 3500) continue;
                    int alpha = (int)(255 * (1.0f - (float)age / 3500f));
                    if (alpha < 5) continue;
                    alpha = Math.Max(0, Math.Min(255, alpha));

                    using (var pen = new Pen(Color.FromArgb(alpha, p2.Color.R, p2.Color.G, p2.Color.B), 5f))
                    {
                        pen.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                        pen.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                        e.Graphics.DrawLine(pen, p1.Point, p2.Point);
                    }
                }
            }

            // Draw a glowing green laser dot with white core if visible
            if (showPointer)
            {
                float radius = 10f;
                using (var glowPen = new Pen(Color.FromArgb(120, 34, 197, 94), 5f))
                {
                    e.Graphics.DrawEllipse(glowPen, pointerPos.X - radius - 2, pointerPos.Y - radius - 2, (radius + 2) * 2, (radius + 2) * 2);
                }
                using (var brush = new SolidBrush(Color.FromArgb(34, 197, 94)))
                {
                    e.Graphics.FillEllipse(brush, pointerPos.X - radius, pointerPos.Y - radius, radius * 2, radius * 2);
                }
                using (var coreBrush = new SolidBrush(Color.FromArgb(220, 255, 255, 255)))
                {
                    e.Graphics.FillEllipse(coreBrush, pointerPos.X - 3, pointerPos.Y - 3, 6, 6);
                }
            }
        }
    }
}
