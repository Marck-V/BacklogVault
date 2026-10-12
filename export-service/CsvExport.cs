using System.Text;
using System.Text.Json.Serialization;

public record LibraryGame(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("added_at")] string AddedAt);

public record LibraryList(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("games")] List<LibraryGame> Games);

public record Library(
    [property: JsonPropertyName("lists")] List<LibraryList> Lists);

public static class CsvExport
{
    public const string Header = "Game,Status,List,Date Added";

    private static readonly char[] FormulaStarts = ['=', '+', '-', '@', '\t', '\r'];
    private static readonly char[] NeedsQuoting = [',', '"', '\n', '\r'];

    // RFC 4180 quoting, plus a leading apostrophe on values a spreadsheet would run as a formula (CSV injection).
    public static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";

        if (Array.IndexOf(FormulaStarts, value[0]) >= 0) value = "'" + value;

        return value.IndexOfAny(NeedsQuoting) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }

    public static string Build(Library library)
    {
        var rows = new List<string> { Header };
        foreach (var list in library.Lists)
        {
            foreach (var game in list.Games)
            {
                var added = game.AddedAt is { Length: >= 10 } ? game.AddedAt[..10] : game.AddedAt;
                rows.Add(string.Join(",", Escape(game.Name), Escape(game.Status), Escape(list.Name), Escape(added)));
            }
        }
        return string.Join("\n", rows);
    }
}
