# Stage 1: SDK image compiles and publishes
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# Copy only the project file first so the restore layer is cached until dependencies change
COPY export-service.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out --no-restore

# Stage 2: much smaller runtime-only image
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
ENV EXPORT_URL=http://0.0.0.0:5000
EXPOSE 5000
ENTRYPOINT ["dotnet", "export-service.dll"]
