public class CsvExportTests
{
    private static Library LibraryOf(params (string list, (string name, string status, string added)[] games)[] lists) =>
        new(lists.Select(l => new LibraryList(l.list, l.games.Select(g => new LibraryGame(g.name, g.status, g.added)).ToList())).ToList());

    [Theory]
    [InlineData("Hades", "Hades")]
    [InlineData("", "")]
    [InlineData("Half-Life 2", "Half-Life 2")]
    [InlineData("Dark Souls: Remastered", "Dark Souls: Remastered")]
    public void Escape_leaves_ordinary_text_alone(string input, string expected) =>
        Assert.Equal(expected, CsvExport.Escape(input));

    [Fact]
    public void Escape_returns_empty_for_null() => Assert.Equal("", CsvExport.Escape(null));

    [Fact]
    public void Escape_quotes_a_value_containing_a_comma_without_changing_it() =>
        Assert.Equal("\"Zelda, Link\"", CsvExport.Escape("Zelda, Link"));

    [Fact]
    public void Escape_doubles_embedded_quotes_inside_a_quoted_value() =>
        Assert.Equal("\"Link's \"\"Awakening\"\"\"", CsvExport.Escape("Link's \"Awakening\""));

    [Theory]
    [InlineData("Two\nLines")]
    [InlineData("Two\r\nLines")]
    public void Escape_quotes_values_with_line_breaks_so_they_stay_in_one_row(string input)
    {
        var escaped = CsvExport.Escape(input);
        Assert.StartsWith("\"", escaped);
        Assert.EndsWith("\"", escaped);
        Assert.Contains("Two", escaped);
        Assert.Contains("Lines", escaped);
    }

    [Theory]
    [InlineData("=SUM(1+1)", "'=SUM(1+1)")]
    [InlineData("+1", "'+1")]
    [InlineData("-2+3", "'-2+3")]
    [InlineData("@cmd", "'@cmd")]
    public void Escape_neutralises_spreadsheet_formulas(string input, string expected) =>
        Assert.Equal(expected, CsvExport.Escape(input));

    [Fact]
    public void Escape_neutralises_a_formula_that_also_needs_quoting() =>
        Assert.Equal("\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"", CsvExport.Escape("=HYPERLINK(\"http://x\",\"y\")"));

    [Fact]
    public void Build_with_no_lists_is_just_the_header() =>
        Assert.Equal("Game,Status,List,Date Added", CsvExport.Build(new Library(new List<LibraryList>())));

    [Fact]
    public void Build_writes_one_row_per_game_in_list_order()
    {
        var csv = CsvExport.Build(LibraryOf(
            ("Alpha", new[] { ("Hades", "Playing", "2026-02-01 10:00:00"), ("Celeste", "Backlog", "2026-01-01 09:00:00") }),
            ("Zed", new[] { ("Tunic", "Completed", "2026-03-05T12:00:00.000Z") })));

        Assert.Equal(string.Join("\n",
            "Game,Status,List,Date Added",
            "Hades,Playing,Alpha,2026-02-01",
            "Celeste,Backlog,Alpha,2026-01-01",
            "Tunic,Completed,Zed,2026-03-05"), csv);
    }

    [Fact]
    public void Build_keeps_awkward_names_in_a_single_well_formed_row()
    {
        var csv = CsvExport.Build(LibraryOf(
            ("Shelf, \"Main\"", new[] { ("Zelda, Link's \"Awakening\"", "Backlog", "2026-10-11 00:00:00") })));

        var lines = csv.Split('\n');
        Assert.Equal(2, lines.Length);
        Assert.Equal("\"Zelda, Link's \"\"Awakening\"\"\",Backlog,\"Shelf, \"\"Main\"\"\",2026-10-11", lines[1]);
    }

    [Fact]
    public void Build_does_not_split_a_name_with_a_newline_into_two_records()
    {
        var csv = CsvExport.Build(LibraryOf(("Main", new[] { ("Two\nLine Game", "Backlog", "2026-10-11 00:00:00") })));
        Assert.Equal("Game,Status,List,Date Added\n\"Two\nLine Game\",Backlog,Main,2026-10-11", csv);
    }

    [Fact]
    public void Build_tolerates_a_short_date_value() =>
        Assert.EndsWith(",short", CsvExport.Build(LibraryOf(("Main", new[] { ("G", "Backlog", "short") }))));
}
