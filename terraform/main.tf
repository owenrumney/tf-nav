resource "google_storage_bucket" "bucket" {
  name     = "my-storage-bucket"
  location = "US"

  versioning {
    enabled = true
  }
}
