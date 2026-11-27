// ═══ Book Técnico — executável do app local (Windows) ═══
// Compilado por tools/build-exe.js com o csc.exe que vem no Windows (.NET Framework 4, C# 5).
// Sobe o servidor local (runtime\node.exe app\server\local-app.js) sem janela de console,
// fica na bandeja do Windows (ícone perto do relógio) com "Abrir" e "Sair" e abre a janela do app.
// Uma instância só: abrir de novo só abre outra janela do app.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Book Técnico")]
[assembly: AssemblyProduct("Book Técnico")]
[assembly: AssemblyCompany("inventCloud")]
[assembly: AssemblyDescription("Book Técnico — app local")]

static class BookTecnico
{
    static Process server;
    static NotifyIcon tray;
    static int port;
    static readonly StringBuilder log = new StringBuilder();
    static string dir = Path.GetDirectoryName(Application.ExecutablePath);
    static string logFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BookTecnico", "app.log");

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        bool first;
        using (var mutex = new Mutex(true, "BookTecnicoAppLocal", out first))
        {
            if (!first) { RunNode(false); return; } // já aberto: o local-app.js só abre outra janela
            if (!RunNode(true)) return;
            tray = new NotifyIcon();
            tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            tray.Text = "Book Técnico";
            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir o Book Técnico", null, delegate { OpenWindow(); });
            menu.Items.Add("Pasta do log", null, delegate { Process.Start("explorer.exe", "/select,\"" + logFile + "\""); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair", null, delegate { Quit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenWindow(); };
            tray.Visible = true;
            tray.ShowBalloonTip(4000, "Book Técnico", "Aberto. Para fechar de vez, clique com o botão direito neste ícone e escolha Sair.", ToolTipIcon.Info);
            Application.Run();
        }
    }

    /// <summary>Roda o node com o local-app.js. keep = true: servidor desta instância (fica rodando).</summary>
    static bool RunNode(bool keep)
    {
        var node = Path.Combine(dir, "runtime", "node.exe");
        var app = Path.Combine(dir, "app", "server", "local-app.js");
        if (!File.Exists(node) || !File.Exists(app))
        {
            MessageBox.Show("Arquivos do app não encontrados ao lado do executável (pastas runtime e app).\nExtraia o ZIP inteiro e abra o BookTecnico.exe de dentro da pasta.", "Book Técnico", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
        var psi = new ProcessStartInfo(node, "\"" + app + "\"");
        psi.WorkingDirectory = Path.Combine(dir, "app");
        psi.UseShellExecute = false;
        psi.EnvironmentVariables["BOOK_LAUNCHER"] = "exe";
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        var p = new Process();
        p.StartInfo = psi;
        p.EnableRaisingEvents = true;
        p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { Output(e.Data); };
        p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { Output(e.Data); };
        try { p.Start(); }
        catch (Exception ex) { MessageBox.Show("Não foi possível iniciar o Book Técnico: " + ex.Message, "Book Técnico", MessageBoxButtons.OK, MessageBoxIcon.Error); return false; }
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        if (!keep) { p.WaitForExit(15000); return true; }
        server = p;
        p.Exited += delegate
        {
            if (quitting) return;
            // o servidor parou sozinho: mostra o motivo (últimas linhas do log) e encerra
            string tail;
            lock (log) { tail = log.ToString(); }
            if (tail.Length > 1500) tail = tail.Substring(tail.Length - 1500);
            MessageBox.Show("O Book Técnico parou.\n\n" + tail, "Book Técnico", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            if (tray != null) tray.Visible = false;
            Application.Exit();
        };
        return true;
    }

    static void Output(string line)
    {
        if (line == null) return;
        lock (log) { log.AppendLine(line); }
        var m = Regex.Match(line, @"http://127\.0\.0\.1:(\d+)");
        if (m.Success) port = int.Parse(m.Groups[1].Value);
        try { Directory.CreateDirectory(Path.GetDirectoryName(logFile)); File.AppendAllText(logFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine); } catch { }
    }

    static void OpenWindow()
    {
        if (port == 0) { MessageBox.Show("O Book Técnico ainda está iniciando. Tente de novo em alguns segundos.", "Book Técnico"); return; }
        var url = "http://127.0.0.1:" + port + "/";
        try { Process.Start("msedge", "--app=" + url); }
        catch { try { Process.Start(url); } catch { } }
    }

    static bool quitting;
    static void Quit()
    {
        quitting = true;
        tray.Visible = false;
        try
        {
            if (server != null && !server.HasExited)
            {
                // pede para o servidor fechar o banco e sair; se não responder, encerra à força
                try { using (var wc = new System.Net.WebClient()) wc.UploadString("http://127.0.0.1:" + port + "/api/local/quit", ""); } catch { }
                if (!server.WaitForExit(8000)) server.Kill();
            }
        }
        catch { }
        Application.Exit();
    }
}
