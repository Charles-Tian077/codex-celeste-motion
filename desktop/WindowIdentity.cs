using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class CodexMotionWindow
{
    public const string AppId = "Local.CodexAmberMotion";

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Format; public uint Index; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropertyValue
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Text;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRect { public int Left, Top, Right, Bottom; }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value);
        void SetValue(ref PropertyKey key, ref PropertyValue value);
        void Commit();
    }

    [DllImport("shell32.dll")]
    private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore properties);
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropertyValue value);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out WindowRect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    private delegate bool EnumWindow(IntPtr window, IntPtr context);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr context);

    private static bool OwnsWindow(IntPtr window, int pid)
    {
        uint owner;
        return window != IntPtr.Zero && GetWindowThreadProcessId(window, out owner) != 0 && owner == (uint)pid;
    }

    public static IntPtr Find(int pid)
    {
        using (var process = Process.GetProcessById(pid))
        {
            if (OwnsWindow(process.MainWindowHandle, pid)) return process.MainWindowHandle;
        }
        IntPtr best = IntPtr.Zero;
        long largest = 0;
        EnumWindows((window, ignored) => {
            if (!OwnsWindow(window, pid) || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
            var name = new StringBuilder(60);
            WindowRect bounds;
            if (GetClassName(window, name, name.Capacity) == 0 || name.ToString() != "Chrome_WidgetWin_1" || !GetWindowRect(window, out bounds)) return true;
            int width = bounds.Right - bounds.Left;
            int height = bounds.Bottom - bounds.Top;
            if (width < 350 || height < 250) return true;
            long area = (long)width * height;
            if (area > largest) { largest = area; best = window; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    private static IPropertyStore Store(IntPtr window, int pid)
    {
        if (!OwnsWindow(window, pid)) throw new InvalidOperationException("Window owner changed.");
        var iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref iid, out store));
        return store;
    }

    private static PropertyKey IdentityKey()
    {
        return new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Index = 5 };
    }

    public static string Read(IntPtr window, int pid)
    {
        var store = Store(window, pid);
        try
        {
            var key = IdentityKey();
            PropertyValue value;
            store.GetValue(ref key, out value);
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Text) : null; }
            finally { PropVariantClear(ref value); }
        }
        finally { Marshal.FinalReleaseComObject(store); }
    }

    public static void Group(IntPtr window, int pid)
    {
        var store = Store(window, pid);
        try
        {
            var key = IdentityKey();
            var value = new PropertyValue { Type = 31, Text = Marshal.StringToCoTaskMemUni(AppId) };
            try { store.SetValue(ref key, ref value); }
            finally { PropVariantClear(ref value); }
        }
        finally { Marshal.FinalReleaseComObject(store); }
    }

    public static void Restore(IntPtr window, int pid)
    {
        if (!OwnsWindow(window, pid)) return;
        if (IsIconic(window) || !IsWindowVisible(window)) ShowWindowAsync(window, 9);
        SetForegroundWindow(window);
    }
}
