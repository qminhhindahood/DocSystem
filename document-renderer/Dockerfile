FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:e1fc6e423f543119c406d24e2e687d67c569f18f04a37a8b0005d80ad0dcee80 AS build
WORKDIR /src
COPY src/DocumentRenderer.Core/DocumentRenderer.Core.csproj src/DocumentRenderer.Core/
COPY src/DocumentRenderer.Api/DocumentRenderer.Api.csproj src/DocumentRenderer.Api/
RUN dotnet restore src/DocumentRenderer.Api/DocumentRenderer.Api.csproj
COPY src ./src
RUN dotnet publish src/DocumentRenderer.Api/DocumentRenderer.Api.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:207cc51496778557731c81ff670333d8ade4a4fec22768fd1be8e78474a84ecf AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      curl \
      fontconfig \
      libreoffice-writer \
      poppler-utils \
      fonts-liberation \
      fonts-crosextra-carlito \
      fonts-crosextra-caladea \
      fonts-noto-core \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/document-renderer /app/fixtures /data/templates \
    && chown -R $APP_UID:$APP_UID /tmp/document-renderer /app/fixtures /data/templates
WORKDIR /app
COPY --from=build /app ./
COPY --chown=$APP_UID:$APP_UID fixtures/readiness.docx /app/fixtures/readiness.docx
ENV ASPNETCORE_URLS=http://+:8080
ENV HOME=/tmp/document-renderer/home
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "DocumentRenderer.Api.dll"]
