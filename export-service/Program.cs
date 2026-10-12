using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

const string SessionCookie = "bv_session";

// The API owns sessions and ownership checks. This service only turns the library it returns into a CSV file.
var apiBase = Environment.GetEnvironmentVariable("API_BASE_URL") ?? "http://localhost:4000";
var sessionToken = new Regex("^[A-Za-z0-9_-]{20,100}$");

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(p => p
        .WithOrigins("http://localhost:5173")
        .AllowCredentials()
        .AllowAnyMethod()
        .AllowAnyHeader())
);
builder.Services.AddHttpClient("api", client =>
{
    client.BaseAddress = new Uri(apiBase);
    client.Timeout = TimeSpan.FromSeconds(10);
});

var app = builder.Build();
app.UseCors();

app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    await next();
});

IResult NothingToExport() =>
    Results.Json(new { error = "Nothing to export yet. Add a game to a list first." }, statusCode: 401);

IResult LibraryUnavailable() =>
    Results.Json(new { error = "Could not load your library right now. Please try again." }, statusCode: 502);

app.MapGet("/export/csv", async (HttpRequest request, HttpResponse response, IHttpClientFactory httpClients) =>
{
    var token = request.Cookies[SessionCookie];
    if (token is null || !sessionToken.IsMatch(token)) return NothingToExport();

    using var apiRequest = new HttpRequestMessage(HttpMethod.Get, "/api/library");
    apiRequest.Headers.Add("Cookie", $"{SessionCookie}={token}");

    Library? library;
    try
    {
        using var apiResponse = await httpClients.CreateClient("api").SendAsync(apiRequest);
        if (apiResponse.StatusCode == HttpStatusCode.Unauthorized) return NothingToExport();
        if (!apiResponse.IsSuccessStatusCode) return LibraryUnavailable();
        library = await apiResponse.Content.ReadFromJsonAsync<Library>();
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
    {
        return LibraryUnavailable();
    }

    if (library is null) return LibraryUnavailable();

    response.Headers.ContentDisposition = "attachment; filename=\"backlog.csv\"";
    return Results.Content(CsvExport.Build(library), "text/csv");
});

app.MapGet("/export/health", () => Results.Ok(new { status = "ok", service = "export-service (C#)" }));

app.Run(Environment.GetEnvironmentVariable("EXPORT_URL") ?? "http://localhost:5000");
