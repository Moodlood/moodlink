using System;
using System.IO.Ports;
using System.Threading;

namespace MoodLinkBluetooth
{
    class Program
    {
        static SerialPort _port;

        static void Main(string[] args)
        {
            if (args.Length == 0)
            {
                Console.WriteLine("Error: Missing COM port argument");
                return;
            }

            string portName = args[0];

            try
            {
                _port = new SerialPort(portName, 9600, Parity.None, 8, StopBits.One);
                _port.DtrEnable = true;
                _port.RtsEnable = true;
                _port.DataReceived += new SerialDataReceivedEventHandler(DataReceivedHandler);
                _port.Open();

                Console.WriteLine("READY");

                // Read from stdin and send to COM port
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (_port.IsOpen)
                    {
                        _port.WriteLine(line);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.Message);
            }
            finally
            {
                if (_port != null && _port.IsOpen)
                {
                    _port.Close();
                }
            }
        }

        private static void DataReceivedHandler(object sender, SerialDataReceivedEventArgs e)
        {
            try
            {
                SerialPort sp = (SerialPort)sender;
                string indata = sp.ReadLine();
                Console.WriteLine(indata);
            }
            catch (Exception) { }
        }
    }
}
