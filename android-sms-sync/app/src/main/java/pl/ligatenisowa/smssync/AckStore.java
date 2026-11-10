package pl.ligatenisowa.smssync;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class AckStore extends SQLiteOpenHelper {
    AckStore(Context context) { super(context, "sms_ack.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE ack (scope TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(scope, hash)) WITHOUT ROWID");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new UnsupportedOperationException("Unknown database version");
    }

    Set<String> load(String scope) {
        Set<String> result = new HashSet<>();
        try (Cursor cursor = getReadableDatabase().query("ack", new String[]{"hash"}, "scope = ?",
                new String[]{scope}, null, null, null)) {
            while (cursor.moveToNext()) result.add(cursor.getString(0));
        }
        return result;
    }

    void save(String scope, List<String> hashes) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (String hash : hashes) {
                ContentValues row = new ContentValues();
                row.put("scope", scope);
                row.put("hash", hash);
                db.insertWithOnConflict("ack", null, row, SQLiteDatabase.CONFLICT_IGNORE);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
}
