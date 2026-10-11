using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

const string SessionCookie = "bv_session";

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(p => p
        .WithOrigins("http://localhost:5173")
        .AllowCredentials()
        .AllowAnyMethod()
        .AllowAnyHeader())
);

var app = builder.Build();
app.UseCors();

string DbPath()
{
    var fromEnv = Environment.GetEnvironmentVariable("DB_PATH");
    if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv;

    var rel = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "backend", "backlog.db");
    return Path.GetFullPath(rel);
}

// Must match the Node API: the cookie holds a random token and the sessions table stores its SHA-256 hex.
string HashToken(string token) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

long? FindUserId(SqliteConnection connection, string? token)
{
    if (string.IsNullOrEmpty(token)) return null;

    using var cmd = connection.CreateCommand();
    cmd.CommandText = "SELECT user_id, expires_at FROM sessions WHERE token_hash = $hash";
    cmd.Parameters.AddWithValue("$hash", HashToken(token));

    using var reader = cmd.ExecuteReader();
    if (!reader.Read()) return null;

    var expires = DateTimeOffset.Parse(reader.GetString(1), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
    return expires > DateTimeOffset.UtcNow ? reader.GetInt64(0) : null;
}

app.MapGet("/export/csv", (HttpRequest request, HttpResponse response) =>
{
    var dbPath = DbPath();
    if (!File.Exists(dbPath))
        return Results.NotFound("Database not found. Make sure the backend has been run at least once.");

    using var connection = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
    connection.Open();

    var userId = FindUserId(connection, request.Cookies[SessionCookie]);
    if (userId is null)
        return Results.Json(new { error = "Nothing to export yet. Add a game to a list first." }, statusCode: 401);

    var rows = new List<string> { "Game,Status,List,Date Added" };

    using var cmd = connection.CreateCommand();
    cmd.CommandText = """
        SELECT lg.name, lg.status, l.name AS list_name, lg.added_at
        FROM list_games lg
        JOIN lists l ON l.id = lg.list_id
        WHERE l.user_id = $userId
        ORDER BY l.name, lg.added_at DESC
        """;
    cmd.Parameters.AddWithValue("$userId", userId.Value);

    using var reader = cmd.ExecuteReader();
    while (reader.Read())
    {
        var game   = reader.GetString(0).Replace(",", " ");
        var status = reader.GetString(1);
        var list   = reader.GetString(2).Replace(",", " ");
        var added  = reader.GetString(3)[..10]; // YYYY-MM-DD
        rows.Add($"{game},{status},{list},{added}");
    }

    var csv = string.Join("\n", rows);
    response.Headers.ContentDisposition = "attachment; filename=\"backlog.csv\"";
    return Results.Content(csv, "text/csv");
});

app.MapGet("/export/health", () => Results.Ok(new { status = "ok", service = "export-service (C#)" }));

app.Run(Environment.GetEnvironmentVariable("EXPORT_URL") ?? "http://localhost:5000");
